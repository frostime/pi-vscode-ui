use std::path::Path;

use windows_sys::Win32::{
    Foundation::{GetLastError, ERROR_ALREADY_EXISTS, WAIT_OBJECT_0},
    System::Threading::{CreateEventW, CreateMutexW, SetEvent, WaitForSingleObject, INFINITE},
};

/// Outcome of the one-time launch-ownership claim, before any window or backend starts.
#[derive(Debug)]
pub enum Claim {
    /// This process owns the profile and must stay created until it exits.
    First { wake: Wake },
    /// Another live process owns this profile and has been asked to surface its window.
    Second,
}

/// Kernel handles backing the profile exclusion; dropping it early would re-open
/// the profile to a second instance, so it is retained for the whole process run.
/// Handles are stored as `usize` so the value can sit in a process-wide sync static.
#[derive(Debug)]
pub struct Wake {
    #[allow(dead_code)] // Keep alive: the kernel object vanishes only once every handle closes.
    mutex: usize,
    event: usize,
}

/// Exclude a second instance over the same data profile. Two Live processes
/// on one profile would race on `state.json`, WebView2 storage and every Pi child.
///
/// The exclusion boundary is the profile, not the executable: the development
/// profile and the packaged profile may run side by side, while repeated launches
/// of one profile — the case that actually corrupts state — are rejected.
pub fn claim(profile: &Path) -> Claim {
    let key = profile_key(profile);
    let mutex_name = wide(&format!("Local\\FrostPi.ProfileMutex.{key}"));
    let wake_name = wide(&format!("Local\\FrostPi.ProfileWake.{key}"));
    unsafe {
        let mutex = CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            // The mutex is abandoned automatically when the owner dies, so an
            // existing mutex always means a live owner. Wake it best effort and quit.
            let event = CreateEventW(std::ptr::null(), 0, 0, wake_name.as_ptr());
            if !event.is_null() {
                SetEvent(event);
            }
            return Claim::Second;
        }
        // Auto-reset so each SetEvent surfaces the window exactly once.
        let event = CreateEventW(std::ptr::null(), 0, 0, wake_name.as_ptr());
        Claim::First {
            wake: Wake {
                mutex: mutex as usize,
                event: event as usize,
            },
        }
    }
}

impl Wake {
    /// Blocks until a second launch asks to surface or the event dies. `false` ends the listener.
    pub fn wait(&self) -> bool {
        unsafe { WaitForSingleObject(self.event as _, INFINITE) == WAIT_OBJECT_0 }
    }
}

/// FNV-1a compresses the profile path into a fixed 16-hex kernel object name,
/// because non-ASCII or long profile paths would be unsafe object names directly.
fn profile_key(profile: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in profile.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x1_0000_001b_3);
    }
    format!("{hash:016X}")
}

fn wide(name: &str) -> Vec<u16> {
    name.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_key_is_stable_and_discriminates() {
        let a = Path::new(r"C:\Users\u\AppData\Roaming\FrostPi");
        let b = Path::new(r"C:\Users\u\AppData\Roaming\FrostPi-Dev");
        assert_eq!(profile_key(a), profile_key(a));
        assert_ne!(profile_key(a), profile_key(b));
        assert_eq!(profile_key(a).len(), 16);
    }

    #[test]
    fn second_claim_over_a_profile_is_rejected_and_wakes_the_owner() {
        let root = std::env::temp_dir().join(format!("frostpi-claim-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let profile = root.join("profile");
        match claim(&profile) {
            Claim::First { wake } => {
                // A second launch over the same profile must be rejected and let the
                // owner surface its window through the wake event.
                assert!(matches!(claim(&profile), Claim::Second));
                assert!(wake.wait());
            }
            Claim::Second => panic!("a fresh exclusive profile was already claimed"),
        }
        // A different profile stays open to its own instance.
        assert!(matches!(claim(&root.join("other")), Claim::First { .. }));
    }
}
