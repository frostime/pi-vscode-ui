use std::{
    path::Path,
    process::{Command, Stdio},
};

/// Node's entrypoint resolver rejects verbatim Windows paths (EISDIR).
/// Normalize cwd as well as using the fixed relative script name.
pub fn command(node: &Path, resources: &Path) -> Command {
    let mut command = Command::new(dunce::simplified(node));
    command
        .arg("backend.cjs")
        .current_dir(dunce::simplified(resources))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn node_boots_from_verbatim_resource_directory_with_spaces_and_unicode() {
        let parent = fs::canonicalize(std::env::temp_dir()).unwrap();
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = parent.join(format!(
            "frostpi-node-启动 path-{}-{stamp}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        fs::write(
            directory.join("backend.cjs"),
            "require('node:fs').writeSync(1, 'FROSTPI_NODE_BOOT_OK');",
        )
        .unwrap();
        let verbatim = fs::canonicalize(&directory).unwrap();
        assert!(verbatim.as_os_str().to_string_lossy().starts_with(r"\\?\"));
        let result = command(Path::new("node"), &verbatim).output();
        // Delete only the exact test-created directory, after resolving and checking its parent.
        assert_eq!(verbatim.parent(), Some(parent.as_path()));
        fs::remove_dir_all(&verbatim).unwrap();
        let output = result.expect("Node must be available for native Desktop verification");
        assert!(output.status.success());
        assert_eq!(output.stdout, b"FROSTPI_NODE_BOOT_OK");
    }
}
