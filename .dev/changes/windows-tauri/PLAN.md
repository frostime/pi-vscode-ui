# Windows Desktop host replacement

Desktop uses one Windows x64 Tauri/WebView2 host, one external Node backend, and the existing shared ClientApp/Registry/Pi runtime. The current architecture and supported behavior are defined in [Desktop SPEC](../../../apps/desktop/SPEC.md), not in the migration's intermediate implementation history.

## Final structure

- `apps/desktop/src/main/backend.ts` is the private Node entry. `createDesktopBackend.ts` owns Desktop business assembly; `DesktopNative` and `DesktopTransport` keep its service dependencies explicit.
- `src-tauri` owns the local window, finite application commands, native services and the Windows process Job Object. Normal close and WebView2 process failure dispose the backend; abnormal native-shell exit kills descendants.
- `build:native`, `start`, root `package:desktop` and `verify:desktop` use this host. `build` remains the JS-only step used by root quality checks. Extension-only builds/publication never require Rust.
- Electron assembly, preload, native adapter, launcher/packager, dependency declarations, obsolete test harnesses and competing `*:tauri` commands are removed. Existing host-independent tests remain; native UI scenarios use WebView2 and backend assembly scenarios use injected services.
- The single ZIP name is `FrostPi-<version>-win32-x64.zip`. Its README declares Node 22.19+, Pi, installed WebView2, the profile location, unsigned distribution and the 32 MiB message policy. JS and locked Rust dependency license texts/source references are included.
- The fixed 32 MiB UTF-8 JSON limit rejects oversized messages while preserving drafts and the live backend. This policy is entirely Desktop-owned; no shared/extension runtime change is needed.

## Verification and evidence limits

The final archive SHA-256, executed checks and source baseline are recorded in [verification.json](verification.json). Repository checks and independent VSIX packaging protect the extension route; native executable/ZIP checks protect the Windows route. Controlled Pi history/streaming and an installed Pi offline command are separate evidence, neither of which claims a real model completion.

`pnpm verify:desktop --native-dialogs` is the explicit foreground-desktop acceptance path for file/folder and confirmation dialogs plus clipboard snapshot/write/restore. This environment did not grant native dialog focus, so that phase remains unverified. Regular automated verification does not seize the user's desktop focus or depend on the user's clipboard formats. Chinese composition delivery is exercised in actual WebView2; complete Windows IME/accessibility coverage and performance benchmarks require separate measurements.

Linux/macOS support, runtime bundling, signing, installers and automatic updates are outside this Windows-only change.
