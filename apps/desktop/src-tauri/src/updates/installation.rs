//! Preserve the selected data profile when MSI relaunches FrostPi.

/// Quote the Windows argument inside the MSI property, including trailing backslashes.
pub fn relaunch_profile(profile: &std::path::Path) -> Result<String, String> {
    let profile = profile.to_string_lossy();
    if profile.contains(['"', '\0', '\r', '\n']) {
        return Err(format!("Data profile {profile:?} contains a quote, NUL or newline; MSI relaunch arguments do not support these characters."));
    }
    let argument =
        crate::native::quote_argument(&format!("{}{}", crate::PROFILE_ARGUMENT, profile));
    Ok(format!(
        "LAUNCHAPPARGS=\"{}\"",
        argument.replace('"', "\"\"")
    ))
}
