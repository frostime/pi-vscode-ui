use serde_json::{json, Value};
use tauri::Manager;
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW};

const MAX_LAUNCH_TARGET_BYTES: usize = 4096;
const MAX_LAUNCH_ARGUMENTS: usize = 16;
const MAX_LAUNCH_ARGUMENT_BYTES: usize = 4096;
const SEE_MASK_NOASYNC: u32 = 0x0000_0100;

pub fn execute(app: &tauri::AppHandle, packet: &Value) -> Result<Value, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Desktop window closed")?;
    let args = packet["args"].as_array().ok_or("Invalid native request")?;
    let text = |index: usize| {
        args.get(index)
            .and_then(Value::as_str)
            .ok_or("Invalid native argument".to_string())
    };
    match packet["operation"].as_str() {
        Some("appearance") => {
            let theme = if text(0)? == "light" {
                tauri::Theme::Light
            } else {
                tauri::Theme::Dark
            };
            window
                .set_theme(Some(theme))
                .map_err(|_| "Could not set theme")?;
            let zoom = args
                .get(2)
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite() && *v >= 0.5 && *v <= 2.0)
                .ok_or("Invalid zoom")?;
            window.set_zoom(zoom).map_err(|_| "Could not set zoom")?;
            Ok(Value::Null)
        }
        Some("writeClipboard") => {
            arboard::Clipboard::new()
                .and_then(|mut clipboard| clipboard.set_text(text(0).unwrap_or_default()))
                .map_err(|_| "Could not write clipboard")?;
            Ok(Value::Null)
        }
        Some("openExternal") => {
            let url = text(0)?;
            if !url.starts_with("https://")
                && !url.starts_with("http://")
                && !url.starts_with("vscode://file/")
            {
                return Err("Unsupported external URL".into());
            }
            shell_execute(url, None).map_err(|_| "Could not open URL")?;
            Ok(Value::Null)
        }
        Some("launch") => {
            let target = text(0)?;
            let arguments = args
                .get(1)
                .and_then(Value::as_array)
                .ok_or("Invalid launch arguments")?;
            if arguments.len() > MAX_LAUNCH_ARGUMENTS {
                return Err("Too many launch arguments".into());
            }
            let mut parts = Vec::with_capacity(arguments.len());
            for argument in arguments {
                let value = argument.as_str().ok_or("Invalid launch argument")?;
                if value.len() > MAX_LAUNCH_ARGUMENT_BYTES
                    || value.contains(['\0', '\r', '\n'])
                {
                    return Err("Invalid launch argument".into());
                }
                parts.push(quote_argument(value));
            }
            if !is_launch_target(target) {
                return Err("Unsupported launch target".into());
            }
            let parameters = parts.join(" ");
            shell_execute(target, Some(&parameters))
                .map_err(|_| "Could not start the program".to_string())?;
            Ok(Value::Null)
        }
        Some("openPath") => {
            shell_execute(text(0)?, None).map_err(|_| "Could not open file")?;
            Ok(json!(""))
        }
        Some("chooseDirectory") => Ok(rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("Add Project")
            .pick_folder()
            .map(|p| json!(p))
            .unwrap_or(Value::Null)),
        Some("openFiles") => {
            let options = args.first().ok_or("Missing file dialog options")?;
            let mut dialog = rfd::FileDialog::new()
                .set_parent(&window)
                .set_title(options["title"].as_str().unwrap_or("Open file"));
            if let Some(path) = options["defaultFsPath"].as_str() {
                let path = std::path::Path::new(path);
                if path.is_file() {
                    if let Some(parent) = path.parent() {
                        dialog = dialog.set_directory(parent);
                    }
                    if let Some(name) = path.file_name() {
                        dialog = dialog.set_file_name(name.to_string_lossy());
                    }
                } else {
                    dialog = dialog.set_directory(path);
                }
            }
            if let Some(filters) = options["filters"].as_object() {
                for (name, extensions) in filters {
                    let extensions: Vec<&str> = extensions
                        .as_array()
                        .ok_or("Invalid filter")?
                        .iter()
                        .filter_map(Value::as_str)
                        .collect();
                    dialog = dialog.add_filter(name, &extensions);
                }
            }
            Ok(dialog
                .pick_file()
                .map(|p| json!([p]))
                .unwrap_or(Value::Null))
        }
        Some("message") | Some("confirm") => {
            let level = match text(0)? {
                "warning" => rfd::MessageLevel::Warning,
                "error" => rfd::MessageLevel::Error,
                _ => rfd::MessageLevel::Info,
            };
            let mut dialog = rfd::MessageDialog::new()
                .set_parent(&window)
                .set_title("FrostPi Desktop")
                .set_level(level)
                .set_description(text(1)?);
            if packet["operation"] == "message" {
                dialog.show();
                return Ok(Value::Null);
            }
            let actions: Vec<String> = args
                .get(2)
                .and_then(Value::as_array)
                .ok_or("Missing actions")?
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
            dialog = match actions.as_slice() {
                [one] => dialog.set_buttons(rfd::MessageButtons::OkCancelCustom(
                    one.clone(),
                    "Cancel".into(),
                )),
                [one, two] => dialog.set_buttons(rfd::MessageButtons::YesNoCancelCustom(
                    one.clone(),
                    two.clone(),
                    "Cancel".into(),
                )),
                _ => return Err("Unsupported confirmation actions".into()),
            };
            Ok(match dialog.show() {
                rfd::MessageDialogResult::Custom(value) if actions.contains(&value) => json!(value),
                _ => Value::Null,
            })
        }
        _ => Err("Unknown native operation".into()),
    }
}

/// Opens a file, folder or URL through the shell's default action.
///
/// The verb and class stay unset on purpose: an explicit `open` verb or the `explore` verb
/// bypasses a replaced default handler (for example a third-party file manager), which is a
/// behaviour regression for the user rather than an implementation detail.
fn shell_execute(target: &str, parameters: Option<&str>) -> Result<(), ()> {
    if target.is_empty()
        || target.len() > MAX_LAUNCH_TARGET_BYTES
        || target.contains(['\0', '\r', '\n'])
    {
        return Err(());
    }
    let file = wide(target);
    let parameters = parameters.map(wide);
    let parameters_ptr = parameters
        .as_ref()
        .map_or(std::ptr::null(), |value| value.as_ptr());
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOASYNC;
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters_ptr;
    info.nShow = 1; // SW_SHOWNORMAL
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(());
    }
    Ok(())
}

/// Accepts an absolute path or a bare file name. The shell resolves a bare name through PATH,
/// which is how Windows Terminal's Store alias stays reachable.
fn is_launch_target(target: &str) -> bool {
    if target.is_empty()
        || target.len() > MAX_LAUNCH_TARGET_BYTES
        || target.contains(['\0', '\r', '\n'])
    {
        return false;
    }
    let path = std::path::Path::new(target);
    if path.is_absolute() {
        return true;
    }
    !target.contains('/') && !target.contains('\\') && !target.contains("..")
}

/// Quotes one command-line argument the way `CreateProcess` expects; the shell passes our
/// parameter string through unchanged.
fn quote_argument(value: &str) -> String {
    if !value.is_empty() && !value.contains([' ', '\t', '"']) {
        return value.to_string();
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => {
                backslashes += 1;
                quoted.push('\\');
            }
            '"' => {
                quoted.push_str(&"\\".repeat(backslashes + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                backslashes = 0;
                quoted.push(character);
            }
        }
    }
    if backslashes > 0 {
        quoted.push_str(&"\\".repeat(backslashes));
    }
    quoted.push('"');
    quoted
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
