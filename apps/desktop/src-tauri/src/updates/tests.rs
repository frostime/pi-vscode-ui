use super::*;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri_plugin_updater::UpdaterExt;

// Local restoration must not contact the network. Installation belongs to MSI.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDgxQjMxMzRBMTcyMkREMzEKUldReDNTSVhTaE96Z1c4cjdlRHBqMWxscGFkSFg5dVhvdHpBK3ZBMGp1VFovZXVLTUVCUFhtSUoK";
const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVReDNTSVhTaE96Z1Rrd2tUSTdGSGw0T1duQi9kQnNwcWI1UDJ0S3cydVVTUGhRTUgxNVlodVRad0dndks1b25SRjk5eFZxWnA4d3pkMGdXZjN5RmJnSGtuRkdlQVh2Y1FNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNzIyMTcxCWZpbGU6aW5zdGFsbGVyLm1zaQl2ZXJzaW9uOjkuOS45ClZyNHNiQVJQeEFxRHE1OUhuVzloM0JXMHQ4S0h2WnFvaFJwN0VGT0d2TzFKTnZPUkZlbFRVOGFtL1dIcm1zNlRxNnp5RDg3cTNlekNvdkR2ZWdpMURnPT0K";
const BYTES: &[u8] = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1FrostPi offline-cache test fixture";

fn updater() -> Updater {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), json!({"pubkey":PUBLIC_KEY}));
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    app.updater_builder()
        .target("windows-x86_64-msi")
        .endpoints(vec!["https://example.invalid/update".parse().unwrap()])
        .unwrap()
        .configure_client(|_| panic!("Offline install attempted a network request"))
        .build()
        .unwrap()
}
fn manifest() -> Value {
    json!({"version":"9.9.9", "notes":"Offline test", "platforms":{
        "windows-x86_64-msi":{"url":"https://example.invalid/installer.msi", "signature":SIGNATURE}
    }})
}
fn directory() -> PathBuf {
    std::env::temp_dir().join(format!(
        "frostpi-update-trust-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn restores_a_download_with_a_fresh_runtime_and_no_network() {
    let root = directory();
    cache::store(&root, &manifest(), BYTES).unwrap();
    let (update, bytes) = restore_cached(&updater(), &root).unwrap().unwrap();
    assert_eq!(update.version, "9.9.9");
    assert_eq!(bytes, BYTES);
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn native_actions_cannot_inject_a_path_url_or_install_option() {
    for action in [
        json!({"type":"install","path":"arbitrary.msi"}),
        json!({"type":"check","url":"https://example.invalid"}),
        json!({"type":"install","force":true}),
    ] {
        assert!(parse_action(&action).is_err());
    }
    assert!(matches!(
        parse_action(&json!({"type":"install"})).unwrap(),
        Action::Install
    ));
}
#[test]
fn msi_profile_argument_preserves_spaces_without_importing_provider_environment() {
    let property =
        installation::relaunch_profile(std::path::Path::new(r"C:\User Data\FrostPi-Dev")).unwrap();
    assert_eq!(
        property,
        "LAUNCHAPPARGS=\"\"\"--frostpi-user-data=C:\\User Data\\FrostPi-Dev\"\"\""
    );
    assert!(installation::relaunch_profile(std::path::Path::new("invalid\"profile")).is_err());
    let profile = r"C:\User Data\中文\";
    let property = installation::relaunch_profile(std::path::Path::new(profile)).unwrap();
    // Windows Installer removes the property's outer quotes and collapses its
    // doubled quotes. The resulting launch string must preserve one exact path.
    let argument = property
        .strip_prefix("LAUNCHAPPARGS=\"")
        .unwrap()
        .strip_suffix('"')
        .unwrap()
        .replace("\"\"", "\"");
    let command: Vec<u16> = format!("app.exe {argument}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe {
        let mut count = 0;
        let args = windows_sys::Win32::UI::Shell::CommandLineToArgvW(command.as_ptr(), &mut count);
        assert!(!args.is_null());
        assert_eq!(count, 2);
        let value = *args.add(1);
        let mut length = 0;
        while *value.add(length) != 0 {
            length += 1;
        }
        let actual = String::from_utf16(std::slice::from_raw_parts(value, length)).unwrap();
        windows_sys::Win32::Foundation::LocalFree(args.cast());
        assert_eq!(actual, format!("{}{}", crate::PROFILE_ARGUMENT, profile));
    }
}
