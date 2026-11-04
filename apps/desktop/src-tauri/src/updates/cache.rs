//! Write the complete installer before atomically publishing its metadata.
//! Incomplete writes are never selected; there is no recovery or cleanup.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CachedRelease {
    filename: String,
    pub release: Value,
}

fn installer_path(root: &Path, filename: &str) -> Result<PathBuf, String> {
    let id = filename
        .strip_prefix("installer-")
        .and_then(|name| name.strip_suffix(".msi"));
    if !id.is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit() || c == b'-')) {
        return Err(format!(
            "Cached installer filename {filename:?} must match installer-<digits-and-hyphens>.msi."
        ));
    }
    Ok(root.join(filename))
}

pub fn load(root: &Path) -> Result<Option<(Value, Vec<u8>)>, String> {
    let path = root.join("ready.json");
    let metadata = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Read {}: {error}", path.display())),
    };
    let cached: CachedRelease = serde_json::from_slice(&metadata)
        .map_err(|error| format!("Invalid {}: {error}", path.display()))?;
    let installer = installer_path(root, &cached.filename)?;
    let bytes =
        fs::read(&installer).map_err(|error| format!("Read {}: {error}", installer.display()))?;
    Ok(Some((cached.release, bytes)))
}

pub fn store(root: &Path, release: &Value, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| format!("Create {}: {error}", root.display()))?;
    let serial = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let filename = format!("installer-{}-{serial}.msi", std::process::id());
    let installer = installer_path(root, &filename)?;
    let mut payload = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&installer)
        .map_err(|error| format!("Create {}: {error}", installer.display()))?;
    payload
        .write_all(bytes)
        .and_then(|_| payload.sync_all())
        .map_err(|error| format!("Write {}: {error}", installer.display()))?;
    drop(payload);
    let metadata = serde_json::to_vec(&CachedRelease {
        filename,
        release: release.clone(),
    })
    .map_err(|error| format!("Encode update metadata: {error}"))?;
    let pending = root.join("ready.json.tmp");
    let mut file =
        File::create(&pending).map_err(|error| format!("Create {}: {error}", pending.display()))?;
    file.write_all(&metadata)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Write {}: {error}", pending.display()))?;
    drop(file);
    fs::rename(&pending, root.join("ready.json"))
        .map_err(|error| format!("Commit {}: {error}", pending.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!(
            "frostpi-update-cache-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn publishes_only_complete_downloads() {
        let root = directory();
        assert!(load(&root).unwrap().is_none());
        store(&root, &json!({"version":"1.0.1"}), b"first").unwrap();
        fs::write(root.join("ready.json.tmp"), b"unfinished metadata").unwrap();
        assert_eq!(
            load(&root).unwrap().unwrap(),
            (json!({"version":"1.0.1"}), b"first".to_vec())
        );
        store(&root, &json!({"version":"1.0.2"}), b"second").unwrap();
        assert_eq!(
            load(&root).unwrap().unwrap(),
            (json!({"version":"1.0.2"}), b"second".to_vec())
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_metadata_paths_outside_the_owned_cache() {
        let root = directory();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("ready.json"),
            br#"{"filename":"../outside.msi","release":{}}"#,
        )
        .unwrap();
        assert!(load(&root)
            .unwrap_err()
            .contains("Cached installer filename"));
        fs::remove_dir_all(root).unwrap();
    }
}
