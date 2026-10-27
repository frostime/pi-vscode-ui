use serde_json::{json, Value};
use tauri::Manager;

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
            open::that_detached(url).map_err(|_| "Could not open URL")?;
            Ok(Value::Null)
        }
        Some("openPath") => {
            open::that_detached(text(0)?).map_err(|_| "Could not open file")?;
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
                dialog = dialog.set_directory(path);
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
