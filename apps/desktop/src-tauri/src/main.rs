#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::OnceLock;

mod native;
mod node_backend;
mod process_tree;
mod single_instance;
mod tray;
mod updates;

/// Owning-launch wake handles stay alive for the whole run; dropping them early
/// would re-open the profile to a second instance.
static WAKE_KEPT: OnceLock<single_instance::Wake> = OnceLock::new();
static PROFILE_KEPT: OnceLock<std::path::PathBuf> = OnceLock::new();

use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager};
use tokio::sync::oneshot;

const MAX_FRAME: usize = 32 * 1024 * 1024;
struct Inner {
    writer: SyncSender<Vec<u8>>,
    queued_bytes: Arc<AtomicUsize>,
    child: Mutex<Child>,
    startup_error: Arc<Mutex<Option<String>>>,
    last_packet: Mutex<&'static str>,
    node_version: Mutex<String>,
    _tree: process_tree::ProcessTree,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    channel: Mutex<Option<Channel<Value>>>,
    serial: AtomicU64,
    started: AtomicBool,
    ready: AtomicBool,
    closing: AtomicBool,
    closed: (Mutex<Option<bool>>, Condvar),
}
#[derive(Clone)]
struct Backend(Arc<Inner>);
impl Backend {
    fn send(&self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|_| "Invalid Desktop message")?;
        if bytes.len() > MAX_FRAME {
            return Err("Desktop message is too large".into());
        }
        bytes.push(b'\n');
        let length = bytes.len();
        self.0
            .queued_bytes
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |queued| {
                (queued + length <= MAX_FRAME * 2).then_some(queued + length)
            })
            .map_err(|_| "Desktop transport queue is full".to_string())?;
        self.0.writer.try_send(bytes).map_err(|_| {
            self.0.queued_bytes.fetch_sub(length, Ordering::AcqRel);
            "Desktop backend is unavailable or busy".to_string()
        })
    }
    async fn lifecycle_request(&self, kind: &str) -> Result<Value, String> {
        let id = self.0.serial.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.0.pending.lock().unwrap();
            if pending.len() >= 1024 {
                return Err("Too many pending Desktop requests".into());
            }
            pending.insert(id, sender);
        }
        if let Err(error) = self.send(json!({"kind":kind,"id":id})) {
            self.0.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let result = tokio::time::timeout(Duration::from_secs(15), receiver).await;
        self.0.pending.lock().unwrap().remove(&id);
        result
            .map_err(|_| "Desktop lifecycle check timed out".to_string())?
            .map_err(|_| "Desktop lifecycle check cancelled".to_string())?
    }
    async fn exit_confirmation_required(&self) -> Result<bool, String> {
        self.lifecycle_request("exitCheck").await?
            .as_bool().ok_or_else(|| "Invalid Desktop exit check".to_string())
    }
    fn publish(&self, value: Value) {
        if let Some(channel) = self.0.channel.lock().unwrap().as_ref() {
            let _ = channel.send(value);
        }
    }
    fn fail(&self) {
        for (_, sender) in self.0.pending.lock().unwrap().drain() {
            let _ = sender.send(Err("Desktop backend stopped".into()));
        }
    }
    fn close(&self, app: tauri::AppHandle) {
        if self.0.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        let backend = self.clone();
        std::thread::spawn(move || {
            let saved = backend.drain();
            if saved.is_err() {
                rfd::MessageDialog::new().set_title("FrostPi Desktop state").set_description("Desktop could not finish saving its state. Existing files were not reset. Check the FrostPi profile before reopening.").set_level(rfd::MessageLevel::Error).show();
            }
            app.exit(if saved.is_ok() { 0 } else { 1 });
        });
    }
    /// Caller claims `closing` first. Both Exit and updates await the same Node
    /// persistence acknowledgement; only Exit may continue after a failed save.
    fn drain(&self) -> Result<(), String> {
        let sent = self.send(json!({"kind":"close"}));
        let saved = if sent.is_ok() {
            let (lock, changed) = &self.0.closed;
            let (closed, _) = changed.wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(15), |value| value.is_none()).unwrap();
            *closed == Some(true)
        } else { false };
        let _ = self.0.child.lock().unwrap().kill();
        if saved { Ok(()) } else { Err("Desktop state was not saved.".into()) }
    }
}

fn start_backend(app: &tauri::App) -> Result<Backend, Box<dyn std::error::Error>> {
    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    compile_error!("FrostPi Desktop currently supports Windows x64 only");
    let resource_directory = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
    } else {
        app.path().resource_dir()?
    };
    // Normalize both cwd and script resolution before handing a Windows path to Node.
    let resources = dunce::simplified(&resource_directory);
    if !resources.join("backend.cjs").is_file() {
        return Err("Desktop backend resource is missing".into());
    }
    let node = std::env::var_os("PATH")
        .and_then(|path| {
            std::env::split_paths(&path)
                .map(|directory| directory.join("node.exe"))
                .find(|path| path.is_file())
        })
        .ok_or("Node.js is not on the desktop PATH")?;
    let mut probe = Command::new(&node);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        probe.creation_flags(0x08000000);
    }
    let version = probe
        .arg("--version")
        .output()
        .map_err(|_| "Node.js version check failed")?;
    let node_version = String::from_utf8_lossy(&version.stdout)
        .trim()
        .trim_start_matches('v')
        .to_string();
    if !version.status.success()
        || node_version.len() > 32
        || !node_version.chars().all(|c| c.is_ascii_digit() || c == '.')
    {
        return Err("Node.js could not run from the desktop PATH".into());
    }
    let mut components = node_version
        .split('.')
        .map(|v| v.parse::<u32>().unwrap_or(0));
    let major = components.next().unwrap_or(0);
    let minor = components.next().unwrap_or(0);
    if major < 22 || major == 22 && minor < 19 {
        return Err("Node.js 22.19 or newer is required".into());
    }
    let mut command = node_backend::command(&node, resources);
    let mut child = command.spawn().map_err(|_| "Could not start Node.js. Install Node 22.19+ and ensure desktop launches can find node on PATH.")?;
    let tree = match process_tree::ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            return Err(error.into());
        }
    };
    let startup_error = Arc::new(Mutex::new(None));
    let diagnostic = startup_error.clone();
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Missing backend diagnostic pipe")?;
    std::thread::spawn(move || {
        use std::io::Read;
        // Read a bounded prefix only to classify Node bootstrap errors. Never log stderr content.
        let mut bytes = Vec::new();
        let _ = (&mut stderr).take(8192).read_to_end(&mut bytes);
        let text = String::from_utf8_lossy(&bytes);
        let code = [
            "MODULE_NOT_FOUND",
            "ERR_REQUIRE_ESM",
            "ERR_DLOPEN_FAILED",
            "SyntaxError",
            "ReferenceError",
            "TypeError",
            "RangeError",
            "EISDIR",
            "ENOENT",
            "EINVAL",
            "EPIPE",
            "EBADF",
            "ENOTSUP",
        ]
        .into_iter()
        .find(|code| text.contains(code))
        .unwrap_or("unclassified");
        diagnostic
            .lock()
            .unwrap()
            .get_or_insert_with(|| code.to_string());
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
    });
    let output = child.stdout.take().ok_or("Missing backend output")?;
    let mut input = child.stdin.take().ok_or("Missing backend input")?;
    let (writer, frames) = sync_channel::<Vec<u8>>(64);
    let queued_bytes = Arc::new(AtomicUsize::new(0));
    let queued = queued_bytes.clone();
    // Only this worker can block on a hung child. Close requests retain their deadline.
    std::thread::spawn(move || {
        for frame in frames {
            let result = input.write_all(&frame).and_then(|_| input.flush());
            queued.fetch_sub(frame.len(), Ordering::AcqRel);
            if result.is_err() {
                break;
            }
        }
    });
    let backend = Backend(Arc::new(Inner {
        writer,
        queued_bytes,
        child: Mutex::new(child),
        startup_error,
        last_packet: Mutex::new("none"),
        node_version: Mutex::new(node_version),
        _tree: tree,
        pending: Mutex::new(HashMap::new()),
        channel: Mutex::new(None),
        serial: AtomicU64::new(0),
        started: AtomicBool::new(false),
        ready: AtomicBool::new(false),
        closing: AtomicBool::new(false),
        closed: (Mutex::new(None), Condvar::new()),
    }));
    let reader = backend.clone();
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut input = BufReader::new(output);
        loop {
            let mut bytes = Vec::new();
            // take() bounds allocation even if a malfunctioning backend omits the newline.
            match std::io::Read::take(&mut input, (MAX_FRAME + 2) as u64)
                .read_until(b'\n', &mut bytes)
            {
                Ok(0) => break,
                Err(_) => {
                    *reader.0.startup_error.lock().unwrap() = Some("stdout-read-failed".into());
                    break;
                }
                _ => {}
            }
            if bytes.len() > MAX_FRAME + 1 || !bytes.ends_with(b"\n") {
                *reader.0.startup_error.lock().unwrap() =
                    Some("incomplete-or-oversized-frame".into());
                break;
            }
            let packet: Value = match serde_json::from_slice(&bytes) {
                Ok(v) => v,
                Err(_) => {
                    *reader.0.startup_error.lock().unwrap() = Some("invalid-backend-json".into());
                    break;
                }
            };
            *reader.0.last_packet.lock().unwrap() = match packet["kind"].as_str() {
                Some("hello") => "hello",
                Some("ready") => "ready",
                Some("response") => "response",
                Some("event") => "event",
                Some("native") => "native",
                Some("closed") => "closed",
                Some("fatal") => "fatal",
                _ => "unknown",
            };
            match packet["kind"].as_str() {
                Some("hello") => {
                    if packet["protocol"] != 1 {
                        break;
                    }
                    if let Some(version) = packet["node"].as_str().filter(|v| {
                        v.len() < 32 && v.chars().all(|c| c.is_ascii_digit() || c == '.')
                    }) {
                        *reader.0.node_version.lock().unwrap() = version.into();
                    }
                }
                Some("ready") => {
                    reader.0.ready.store(true, Ordering::Release);
                }
                Some("response") => {
                    if let Some(id) = packet["id"].as_u64() {
                        if let Some(sender) = reader.0.pending.lock().unwrap().remove(&id) {
                            let _ = sender.send(if packet["ok"] == true {
                                Ok(packet["value"].clone())
                            } else {
                                Err("Desktop operation failed".into())
                            });
                        }
                    }
                }
                Some("event") => reader.publish(packet),
                Some("native") if packet["operation"] == "appearance" => {
                    let result = native::execute(&handle, &packet);
                    let _ = reader.send(json!({"kind":"nativeResult","id":packet["id"],"ok":result.is_ok(),"value":null}));
                }
                Some("native") if packet["operation"] == "updates" => {
                    let backend = reader.clone();
                    let app = handle.clone();
                    std::thread::spawn(move || updates::dispatch(app, backend, packet));
                }
                Some("native") => {
                    let backend = reader.clone();
                    let app = handle.clone();
                    std::thread::spawn(move || {
                        let result = native::execute(&app, &packet);
                        let _ = backend.send(match result { Ok(value) => json!({"kind":"nativeResult","id":packet["id"],"ok":true,"value":value}), Err(_) => json!({"kind":"nativeResult","id":packet["id"],"ok":false}) });
                    });
                }
                Some("closed") => {
                    *reader.0.closed.0.lock().unwrap() = Some(packet["ok"] == true);
                    reader.0.closed.1.notify_all();
                }
                Some("fatal") => {
                    *reader.0.startup_error.lock().unwrap() =
                        Some("backend-initialization-failed".into());
                    reader.publish(packet);
                    break;
                }
                _ => break,
            }
        }
        reader.fail();
        if !reader.0.closing.load(Ordering::Acquire) {
            rfd::MessageDialog::new()
                .set_title("FrostPi Desktop")
                .set_description("The Desktop backend stopped. Existing settings were not reset.")
                .set_level(rfd::MessageLevel::Error)
                .show();
            reader.0.closing.store(true, Ordering::Release);
            handle.exit(1);
        }
    });
    Ok(backend)
}

// Used only to preserve a custom data profile through MSI's automatic relaunch.
const PROFILE_ARGUMENT: &str = "--frostpi-user-data=";
fn profile_directory() -> PathBuf {
    PROFILE_KEPT.get_or_init(|| {
        // MSI can change the working directory and inherited environment. Its
        // private argument names the original instance's already-resolved profile.
        let profile = std::env::args().skip(1)
            .find_map(|arg| arg.strip_prefix(PROFILE_ARGUMENT).map(PathBuf::from))
            .or_else(|| std::env::var_os("FROSTPI_DESKTOP_USER_DATA").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA must be defined")).join("FrostPi"));
        if !profile.is_absolute() {
            rfd::MessageDialog::new()
                .set_title("FrostPi data directory is invalid")
                .set_description("FrostPi requires an absolute Windows data directory, for example D:\\FrostPiData. Set FROSTPI_DESKTOP_USER_DATA to an absolute path. Relative paths are not supported; no profile was opened and no default directory was substituted.")
                .set_level(rfd::MessageLevel::Error)
                .show();
            std::process::exit(1);
        }
        profile
    }).clone()
}
fn local_url(url: &tauri::Url) -> bool {
    url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.host_str() == Some("tauri.localhost") && matches!(url.scheme(), "http" | "https")
            || url.host_str() == Some("localhost") && url.scheme() == "tauri")
}
fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    // No remote navigations or additional windows are permitted by the builder.
    if window.label() != "main" || !window.url().map(|url| local_url(&url)).unwrap_or(false) {
        return Err("Unauthorized Desktop window".into());
    }
    Ok(())
}
#[tauri::command]
async fn desktop_connect(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, Backend>,
    channel: Channel<Value>,
) -> Result<(), String> {
    authorize(&window)?;
    if state.0.closing.load(Ordering::Acquire) {
        return Err("Desktop is closing".into());
    }
    *state.0.channel.lock().unwrap() = Some(channel);
    if !state.0.started.swap(true, Ordering::SeqCst) {
        let profile = profile_directory();
        state.send(json!({"kind":"init","profile":profile,"version":app.package_info().version.to_string(),"directories":std::env::args().skip(1).filter(|arg| !arg.starts_with(PROFILE_ARGUMENT)).collect::<Vec<_>>()}))?;
    }
    for _ in 0..300 {
        if state.0.ready.load(Ordering::Acquire) {
            window.show().map_err(|_| "Could not show Desktop window")?;
            return Ok(());
        }
        let status = state.0.child.lock().unwrap().try_wait().ok().flatten();
        if let Some(status) = status {
            return Err(format!(
                "Desktop backend stopped during startup ({}; packet={}; node={}; exit={:?})",
                state
                    .0
                    .startup_error
                    .lock()
                    .unwrap()
                    .as_deref()
                    .unwrap_or("no diagnostic"),
                *state.0.last_packet.lock().unwrap(),
                *state.0.node_version.lock().unwrap(),
                status.code()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("Desktop backend startup timed out".into())
}
#[tauri::command]
async fn desktop_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Backend>,
    request: Value,
) -> Result<Value, String> {
    authorize(&window)?;
    if !state.0.ready.load(Ordering::Acquire) || state.0.closing.load(Ordering::Acquire) {
        return Err("Desktop is not ready".into());
    }
    let id = state.0.serial.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = state.0.pending.lock().unwrap();
        if pending.len() >= 1024 {
            return Err("Too many pending Desktop requests".into());
        }
        pending.insert(id, sender);
    }
    if let Err(error) = state.send(json!({"kind":"request","id":id,"request":request})) {
        state.0.pending.lock().unwrap().remove(&id);
        return Err(error);
    }
    receiver
        .await
        .map_err(|_| "Desktop request cancelled".to_string())?
}
// Preserve backend disposal when the native browser loses its conversation renderer.
fn watch_webview(
    window: &tauri::WebviewWindow,
    backend: Backend,
    handle: tauri::AppHandle,
) -> tauri::Result<()> {
    window.with_webview(move |platform| unsafe {
        use webview2_com::{
            Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
                COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
            },
            ProcessFailedEventHandler,
        };
        let failed_backend = backend.clone();
        let failed_app = handle.clone();
        let result = platform.controller().CoreWebView2().and_then(|core| {
            core.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut kind = Default::default();
                        args.ProcessFailedKind(&mut kind)?;
                        if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                            || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                        {
                            failed_backend.close(failed_app.clone());
                        }
                    }
                    Ok(())
                })),
                &mut 0,
            )
        });
        if result.is_err() {
            backend.close(handle);
        }
    })
}

fn publish_window_state(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible =
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
        let backend = app.state::<Backend>();
        let _ = backend.send(json!({"kind":"window","focused":visible && window.is_focused().unwrap_or(false),"visible":visible}));
    }
}

fn main() {
    // Decide launch ownership before touching the profile, the backend or the tray,
    // so the rejected runner exits before creating kernel state of its own.
    match single_instance::claim(&profile_directory()) {
        single_instance::Claim::Second => return,
        single_instance::Claim::First { wake } => {
            let _ = WAKE_KEPT.set(wake);
        }
    }
    tauri::Builder::default()
        // Rust updater API only. No updater permissions are granted to the webview.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![desktop_connect, desktop_request])
        .setup(|app| {
            let config = serde_json::from_value::<tauri_plugin_updater::Config>(app.config().plugins.0.get("updater").cloned().unwrap_or_else(|| json!({"pubkey":""})))?;
            let cache = app.path().local_data_dir()?.join("FrostPi/updates").join(single_instance::profile_key(&profile_directory()));
            app.manage(updates::Updates::new(app.package_info().version.to_string(), cache, config));
            let backend = start_backend(app)?;
            app.manage(backend);
            let window = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(profile_directory().join("WebView2"))
                .on_navigation(local_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            let backend = app.state::<Backend>().inner().clone();
            let handle = app.handle().clone();
            tray::install(app)?;
            watch_webview(&window, backend, handle)?;
            if let Some(wake) = WAKE_KEPT.get() {
                let surface = app.handle().clone();
                std::thread::spawn(move || {
                    while wake.wait() {
                        let _ = tray::restore(&surface);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.try_state::<Backend>().is_none() { return; }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); tray::hide(window.app_handle()); }
                tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_) => publish_window_state(window.app_handle()),
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|_| { rfd::MessageDialog::new().set_title("FrostPi Desktop could not start").set_description("Check the following, then open FrostPi again:\n\n1. Install Node.js 22.19 or newer and make sure node is on the Windows PATH. If a newly installed Node.js is still not found, sign out of Windows and sign in again to refresh the desktop environment.\n2. Install or repair Microsoft Edge WebView2 Runtime.\n3. Repair the FrostPi MSI installation, or extract the entire portable ZIP. Keep the Desktop executable, backend.cjs and the pi-extensions folder together.\n\nPi is installed separately. If Pi is missing, the app will show setup instructions when you start a session.").set_level(rfd::MessageLevel::Error).show(); std::process::exit(1); })
        .run(|app, event| { if let tauri::RunEvent::ExitRequested { api, .. } = event { let backend = app.state::<Backend>(); if !backend.0.closing.load(Ordering::Acquire) { api.prevent_exit(); tray::request_exit(app); } } });
}
