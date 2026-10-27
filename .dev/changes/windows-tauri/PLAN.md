# Windows Tauri migration

Scope: Windows x64 only. Reuse the shared client and Pi RPC runtime. Keep Node and Pi as machine prerequisites; use the installed Evergreen WebView2 Runtime. No Linux/macOS builds, installer, signing, updater, provider credentials or shared-session rewrite.

## Branch baseline

- `quasi-main` fast-forwarded to `main` (`2ed69c1`).
- `feat/desktop-host` (`647f751`) merged with `--no-ff`: `9d9dfbb`.
- Implementation branch: `codex/windows-tauri-desktop`.

## Delivery sequence and acceptance

1. Extract a native-independent Desktop backend; preserve Electron as a regression baseline. Existing Desktop unit tests and actual Electron smoke must pass.
2. Add a Windows Tauri shell and one persistent external Node backend. Renderer gets finite application commands; only the backend can request native operations. Use ordered frontend channels and bounded private stdio; preserve shared schema/session authorization.
3. Exercise an actual WebView2 window: startup, settings, Projects, a controlled Pi conversation, concurrent sessions, Stop, Resume, dialogs, clipboard/file actions, appearance, shutdown/reopen and abnormal process cleanup.
4. Produce a release-mode Windows ZIP outside Electron, verify its extracted executable outside the repository, and compare archive size. Switch the default Desktop distribution only after native parity is established.
5. Run the repository checks and extension packaging regression; update current contracts/workflows and retain reproducible native evidence.

## Risks to resolve

- Large attachment/snapshot transport: stdio currently caps each frame at 32 MiB. The shared bridge can accept larger aggregate images. Do not increase the cap as a substitute for a bounded transfer design; explicit overflow handling and native verification remain required before parity.
- Node discovery must work from the normal desktop PATH, including packaged launches outside the source checkout. Pi currently requires Node 22.19+.
- WebView2 IPC/CSP, asset URLs, IME/clipboard and native zoom must be exercised in the real window. Typecheck is insufficient.
- Close must drain metadata and stop children; a Windows kill-on-close Job Object provides abnormal-exit cleanup. Forced cleanup must not claim a successful save.
- Rust is a new contributor prerequisite for native builds. Shared/extension-only build and verification must remain independent of Rust.

## Current evidence (2026-10-27)

The first executable milestone is complete. This is not full native parity or a default-distribution switch.

- Root `pnpm check` passed: lint, typecheck, 984 tests, both product JS builds and extension bundle budgets. Final Desktop bootstrap/script edits additionally passed focused typecheck/lint and all 149 Desktop tests.
- Existing actual Electron smoke passed its complete reported surface on the extracted backend: parallel Pi, Stop isolation, settings import/save/reopen, file links, theme/zoom, state reopen, Resume, Project ownership/removal and sidebar layout. It remains the default entry.
- Windows Rust checks/release build passed. The real-Node native regression passed against a canonical verbatim path containing spaces and Unicode.
- `pnpm package:vsix` and `pnpm verify:vsix` passed independently: 78 entries, approximately 2.65 MB. VS Code/shared source behavior was not rewritten for Tauri.
- The final release ZIP passed `verify:tauri`: payload allowlist, extraction outside the repository, configured Windows machine/user PATH, actual WebView2/client mount, invalid-operation rejection, controlled Pi prompt and assistant response, Mermaid, live theme and measured native zoom, normal close/state flush, reopen, and forced-shell Node/Pi descendant cleanup. These are controlled Pi checks, not real-model acceptance.
- Final archive: `artifacts/FrostPi-0.15.5-tauri-win32-x64.zip`, 5,598,540 bytes (5.34 MiB), 14,127,190 bytes unpacked (13.47 MiB). SHA-256: `4fb3d2b2c3acb66b7c19bb7582bb30ef1adef904da29fc2c94409fd31f8973c1`.
- Existing Electron comparison archive: 161,492,412 bytes (154.01 MiB), approximately 376.86 MiB unpacked. The Tauri archive is approximately 96.5% smaller; memory/startup improvements have not been measured.
- Source identity: uncommitted implementation on `codex/windows-tauri-desktop`, based on `9d9dfbbd896b00dfe91eaf3d135cfebe01a1d6a2`. The archive hash identifies the tested binary; this is not a committed/tagged release.

## Resolved native startup issue

The first release-path verification failed before the Node backend handshake. Node 24.12.0 reproducibly rejected a Windows `\\?\H:\...` verbatim entry path with `EISDIR` while the ordinary development path worked. The launcher now normalizes the trusted resource directory with `dunce`, sets that directory as cwd and passes only the fixed `backend.cjs` script name. A real Node regression covers this boundary. Native status is registered before creating the renderer, and blocking pipe writes use a bounded worker queue so the close deadline remains effective. Bootstrap metadata contains only protocol/Node versions; startup diagnostics never print raw stderr or conversation content.

## Remaining migration gates

1. Design and verify bounded transfer for attachment/draft/snapshot messages exceeding the 32 MiB frame cap. Do not enlarge the cap to hide the protocol gap. Oversized native transfers remain a preview limitation.
2. Extend actual Tauri acceptance to two-Project concurrent execution/Stop isolation, complete Resume interactions, native file/folder/confirmation/clipboard flows, IME and renderer failure paths. Shared/Electron tests are supporting evidence, not native-binding acceptance.
3. Run an isolated installed-Pi command/UI check and real-user GUI acceptance; compare whole-process memory and startup time if resource reduction is a decision gate.
4. Complete native distribution attribution/review, then switch default commands and remove Electron only after the parity gates pass. Signing, installer and updater remain separately scoped.

No migration implementation commit, push, tag or publication was made. The authorized `quasi-main` merge commit is already present.
