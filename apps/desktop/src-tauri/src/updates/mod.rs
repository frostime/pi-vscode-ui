//! The Desktop update coordinator owns cached files and operation state. All
//! network, version, signature and MSI execution mechanisms stay in Tauri's Rust API.
//! The plugin is registered for its Rust API, but renderer updater permissions are never granted.
mod cache;
mod installation;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::Manager;
use tauri_plugin_updater::{Config, Update, Updater, UpdaterExt};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Read,
    Check,
    Download,
    Install,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ActionRequest {
    #[serde(rename = "type")]
    action: Action,
}
fn parse_action(input: &Value) -> Result<Action, String> {
    serde_json::from_value::<ActionRequest>(input.clone())
        .map(|request| request.action)
        .map_err(|error| format!("Invalid update action: {error}"))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseView {
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct DownloadedView {
    version: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    received_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    current_version: String,
    configured: bool,
    checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    available: Option<ReleaseView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    downloaded: Option<DownloadedView>,
    operation: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<Progress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
struct State {
    view: View,
    available: Option<Update>,
    initialized: bool,
}
pub struct Updates {
    cache: PathBuf,
    state: Mutex<State>,
}

impl Updates {
    pub fn new(version: String, cache: PathBuf, config: Config) -> Self {
        let configured = !config.pubkey.trim().is_empty() && !config.endpoints.is_empty();
        Self {
            cache,
            state: Mutex::new(State {
                view: View {
                    current_version: version,
                    configured,
                    checked: false,
                    available: None,
                    downloaded: None,
                    operation: "idle",
                    progress: None,
                    error: (!configured)
                        .then(|| "Updates are not configured for this build.".into()),
                },
                available: None,
                initialized: false,
            }),
        }
    }

    fn updater(&self, app: &tauri::AppHandle) -> Result<Updater, String> {
        // The public builder cannot replace current_exe_args. Use the official
        // MSI relaunch properties to preserve the profile rather than relying on
        // a custom environment surviving elevation / Windows Installer's service.
        let profile = crate::profile_directory();
        let relaunch = installation::relaunch_profile(&profile)?;
        app.updater_builder()
            .target("windows-x86_64-msi")
            .timeout(Duration::from_secs(60))
            // Supply relaunch properties below instead of forwarding stale Project arguments.
            .restart_after_install(false)
            // A concurrently launched instance must not be killed or cause an OS reboot.
            .installer_args([
                "REBOOT=ReallySuppress",
                "MSIRESTARTMANAGERCONTROL=Disable",
                "MSIDISABLERMRESTART=1",
                "AUTOLAUNCHAPP=True",
            ])
            .installer_arg(relaunch)
            .build()
            .map_err(|error| format!("Invalid updater configuration: {error}"))
    }

    pub fn accept(
        &self,
        app: &tauri::AppHandle,
        input: &Value,
    ) -> Result<(View, Option<Action>), String> {
        let action = parse_action(input)?;
        let mut state = self.state.lock().unwrap();
        if !state.initialized {
            if state.view.configured {
                state.view.downloaded =
                    restore_cached(&self.updater(app)?, &self.cache)?.map(|(update, _)| {
                        DownloadedView {
                            version: update.version,
                        }
                    });
            }
            state.initialized = true;
        }
        if matches!(action, Action::Read) {
            return Ok((state.view.clone(), None));
        }
        if !state.view.configured {
            return Err("Update configuration requires a public key and endpoint; this build has no configured updater.".into());
        }
        if state.view.operation != "idle" {
            return Err("Another update operation is in progress.".into());
        }
        if matches!(action, Action::Download) && state.available.is_none() {
            return Err("Check for a new version before downloading.".into());
        }
        state.view.operation = match action {
            Action::Check => "checking",
            Action::Download => "downloading",
            Action::Install => "preparingInstall",
            Action::Read => unreachable!(),
        };
        state.view.error = None;
        state.view.progress = None;
        Ok((state.view.clone(), Some(action)))
    }

    fn publish(&self, backend: &crate::Backend) {
        let view = self.state.lock().unwrap().view.clone();
        let _ = backend.send(json!({"kind":"updateView", "view":view}));
    }

    async fn perform(
        &self,
        app: &tauri::AppHandle,
        backend: &crate::Backend,
        action: Action,
    ) -> Result<(), String> {
        let updater = self.updater(app)?;
        match action {
            Action::Check => {
                let update = updater
                    .check()
                    .await
                    .map_err(|error| format!("Update check failed: {error}"))?;
                let mut state = self.state.lock().unwrap();
                state.view.checked = true;
                state.view.available = update.as_ref().map(release_view);
                state.available = update;
            }
            Action::Download => {
                let update = self
                    .state
                    .lock()
                    .unwrap()
                    .available
                    .clone()
                    .ok_or("Check for a new version before downloading.")?;
                let mut received = 0;
                let mut last_progress = std::time::Instant::now();
                let bytes = update
                    .download(
                        |count, total| {
                            received += count as u64;
                            if last_progress.elapsed() >= Duration::from_millis(150) {
                                self.state.lock().unwrap().view.progress = Some(Progress {
                                    received_bytes: received,
                                    total_bytes: total,
                                });
                                self.publish(backend);
                                last_progress = std::time::Instant::now();
                            }
                        },
                        || {},
                    )
                    .await
                    .map_err(|error| format!("Update download failed: {error}"))?;
                cache::store(&self.cache, &update.raw_json, &bytes)?;
                let mut state = self.state.lock().unwrap();
                state.view.downloaded = Some(DownloadedView {
                    version: update.version.clone(),
                });
                state.view.progress = Some(Progress {
                    received_bytes: bytes.len() as u64,
                    total_bytes: Some(bytes.len() as u64),
                });
            }
            Action::Install => {
                // Use the committed local download, not a fresh latest request.
                let (update, bytes) = restore_cached(&updater, &self.cache)?
                    .ok_or("No downloaded update newer than the current version exists.")?;
                let preparation = backend.lifecycle_request("prepareUpdate").await?;
                if preparation["ok"] != true {
                    return Err(if preparation["reason"] == "opening" {
                        "Finish or cancel New/Resume before installing the update."
                    } else {
                        "Please close all sessions in every Project before installing the update."
                    }
                    .into());
                }
                if backend
                    .0
                    .closing
                    .swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    return Err("Desktop is already closing.".into());
                }
                let draining = backend.clone();
                tauri::async_runtime::spawn_blocking(move || draining.drain())
                    .await
                    .map_err(|error| format!("Desktop state save task failed: {error}"))??;
                // On Windows success exits the process. Node is already saved and
                // stopped; the installer is launched outside Node's kill-on-close Job.
                update
                    .install(&bytes)
                    .map_err(|error| format!("MSI installation failed: {error}"))?;
            }
            Action::Read => unreachable!(),
        }
        Ok(())
    }
}

/// Queue the native acknowledgement first. Installing is a terminal operation;
/// the originating renderer request must not wait for an already-closed backend.
pub fn dispatch(app: tauri::AppHandle, backend: crate::Backend, packet: Value) {
    let accepted = packet["args"]
        .as_array()
        .filter(|args| args.len() == 1)
        .ok_or_else(|| "Invalid update request.".to_string())
        .and_then(|args| app.state::<Updates>().accept(&app, &args[0]));
    match accepted {
        Ok((view, action)) => {
            if backend
                .send(json!({"kind":"nativeResult","id":packet["id"],"ok":true,"value":view}))
                .is_err()
            {
                installation_error(&app, "Desktop backend rejected the update acknowledgement.");
                return;
            }
            if let Some(action) = action {
                tauri::async_runtime::spawn(async move {
                    let updates = app.state::<Updates>();
                    if let Err(error) = updates.perform(&app, &backend, action).await {
                        if backend.0.closing.load(std::sync::atomic::Ordering::SeqCst) {
                            installation_error(&app, &error);
                            return;
                        }
                        updates.state.lock().unwrap().view.error = Some(error);
                    }
                    updates.state.lock().unwrap().view.operation = "idle";
                    updates.publish(&backend);
                });
            }
        }
        Err(error) => {
            let _ = backend
                .send(json!({"kind":"nativeResult","id":packet["id"],"ok":false,"error":error}));
        }
    }
}

fn release_view(update: &Update) -> ReleaseView {
    ReleaseView {
        version: update.version.clone(),
        notes: update.body.clone(),
    }
}

fn restore_cached(
    updater: &Updater,
    root: &std::path::Path,
) -> Result<Option<(Update, Vec<u8>)>, String> {
    let Some((metadata, bytes)) = cache::load(root)? else {
        return Ok(None);
    };
    Ok(updater
        .restore_update(metadata)
        .map_err(|error| format!("Cached update metadata is invalid: {error}"))?
        .map(|update| (update, bytes)))
}
fn installation_error(app: &tauri::AppHandle, message: &str) {
    eprintln!("{message}");
    rfd::MessageDialog::new()
        .set_title("FrostPi update was not installed")
        .set_description(message)
        .set_level(rfd::MessageLevel::Error)
        .show();
    app.exit(1);
}

#[cfg(test)]
mod tests;
