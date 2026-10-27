#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native;
mod node_backend;
mod process_tree;

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
            let _ = backend.send(json!({"kind":"close"}));
            let (lock, changed) = &backend.0.closed;
            let (closed, _) = changed
                .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(15), |v| {
                    v.is_none()
                })
                .unwrap();
            if *closed != Some(true) {
                rfd::MessageDialog::new().set_title("FrostPi Desktop state").set_description("Desktop could not finish saving its state. Existing files were not reset. Check the FrostPi profile before reopening.").set_level(rfd::MessageLevel::Error).show();
            }
            let _ = backend.0.child.lock().unwrap().kill();
            app.exit(if *closed == Some(true) { 0 } else { 1 });
        });
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

fn profile_directory() -> PathBuf {
    std::env::var_os("FROSTPI_DESKTOP_USER_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("APPDATA").expect("APPDATA must be defined"))
                .join("FrostPi")
        })
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
        state.send(json!({"kind":"init","profile":profile,"version":app.package_info().version.to_string(),"directories":std::env::args().skip(1).collect::<Vec<_>>()}))?;
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
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_connect, desktop_request])
        .setup(|app| {
            let backend = start_backend(app)?;
            app.manage(backend);
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .data_directory(profile_directory().join("WebView2"))
                .on_navigation(local_url)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(backend) = window.try_state::<Backend>() else { return; };
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); backend.close(window.app_handle().clone()); }
                tauri::WindowEvent::Focused(focused) => { let _ = backend.send(json!({"kind":"window","focused":focused,"visible":!window.is_minimized().unwrap_or(false)})); }
                tauri::WindowEvent::Resized(_) => { let _ = backend.send(json!({"kind":"window","focused":window.is_focused().unwrap_or(false),"visible":!window.is_minimized().unwrap_or(false)})); }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|_| { rfd::MessageDialog::new().set_title("FrostPi Desktop").set_description("FrostPi could not start. Install Node 22.19+ and WebView2 Runtime, and check that Node is on the desktop PATH.").set_level(rfd::MessageLevel::Error).show(); std::process::exit(1); })
        .run(|app, event| { if let tauri::RunEvent::ExitRequested { api, .. } = event { let backend = app.state::<Backend>(); if !backend.0.closing.load(Ordering::Acquire) { api.prevent_exit(); backend.close(app.clone()); } } });
}
