# Desktop contracts

## Session and presentation

Store Session-to-Project associations in Desktop navigation metadata. Reassigning a Session to another Project must not change that Session's id or cwd. After Project selection completes, `SessionRegistry.activeSessionId` must name one of that Project's Sessions or be null. Filtering the visible Session list cannot substitute for updating this Registry selection.

While the same Session remains selected, sidebar hide/resize, theme/zoom changes and Resume/transport-limit overlays must not remount ClientApp or Composer or discard its draft. Hiding the Resume overlay alone must not cancel the pending Resume request. Attribute any later result to the Project that initiated that request, even if another Project is now selected.

## Projects, order and external tools

Project order is user-owned. It is the order of the `projects` array in `state.json`, changes only through an explicit move, and survives restart. Reordering must not change a Project's id, name, cwd, the selected Project, or any Session's Project association.

The Project action menu is projected from one main-process registry (`apps/desktop/src/main/projectActions.ts`). That registry owns built-in availability and combines saved command metadata with the detected tools; the renderer returns only `(projectId, actionId)`, never a command or root directory. Main resolves the clicked Project's cwd and checks a command's saved Project association again at execution, rather than trusting a stale menu. Tool detection is startup state, not persisted settings and never re-run from the renderer.

The sidebar Project menu contains Open In and Remove only. The main-panel Project menu adds one Actions section; global and Project commands differ by icon, not separate menu sections. Its settings gear opens the existing Settings Actions category in global scope. Project configuration requires an explicit Project selection independent of navigation; neither entry into settings nor editing another Project may select a Project implicitly.

Terminal Actions deliberately hand execution to a new external Windows Terminal window running Windows PowerShell. FrostPi does not collect output, track lifetime, stop tasks or restart failures. The shell remains after command completion. User commands come only from Desktop settings and run only on an explicit click, never from repository configuration. `{{cwd}}` is a safely quoted complete PowerShell argument, not raw path interpolation or a general template language. Commands may contain credentials: keep them out of logs, error messages and settings change-summary text.

Opening a folder, file or URL uses the shell's default action (`native.rs::shell_execute`, verb and class unset). Never pass an explicit `open` verb, the `explore` verb, or `SHOpenFolderAndSelectItems`: each of them bypasses a replaced default handler, for example a third-party file manager registered as the default verb for folders.

External programs are started by the native shell, never by Node. The Node backend runs inside a `KILL_ON_JOB_CLOSE` job object, so any process it spawns dies with the application; a launched editor or terminal must outlive FrostPi.

## Window and application lifetime

Closing the main window hides it to the Windows tray; it must not dispose the backend, stop Pi children or remount ClientApp. The first close in each launch explains the tray behavior. Tray left-click and Show restore the same window and its drafts. Hidden windows report invisible to the backend so restoring them refreshes the shared presentation.

One Live process owns a data profile: a second launch over that profile wakes the owner (through the same restore path) and exits quietly, before creating backend state. The claim is decided before the tray or backend start and dies with the process, so an owner killed without cleanup does not block the next launch. Exclusion is scoped per profile, so differently profiled instances may run side by side; a duplicate instance never races over `state.json`, WebView2 storage or Pi children.

Only explicit Exit or user-requested installation of a downloaded update ends normal application lifetime. Node checks activity across all Projects, including pending input and process/session operations; the native shell asks for confirmation when that work would be interrupted. Cancelling leaves tasks running. Approval uses the same bounded stop/metadata-drain path as before; renderer/browser failure still terminates through that path rather than hiding a broken window. Exit checks travel over the private shell/backend wire, not the renderer bridge.

## Persistence

Only Session ids admitted by shared `SessionPersistence` may appear in persisted Desktop Session-to-Project mappings or last-viewed selections. Eligibility is defined in `apps/pi-client/src/host/session-lifecycle.SPEC.md`.

Report application shutdown as saved only after Registry session metadata and Desktop navigation metadata have been flushed to `state.json`. A load/validation failure for `settings.json` or `state.json` must preserve the file and block writes until a successful load; never initialize defaults over the failed file.

## Settings and initial import

The development launcher isolates only FrostPi-owned settings/state and WebView2 storage. It must not redirect Pi agent/session directories or copy credentials. Normal packaged launches keep the existing profile, and an explicit `FROSTPI_DESKTOP_USER_DATA` takes precedence in both normal launch paths. A profile must be an absolute Windows path: reject relative paths at native startup, before claiming or opening a profile, with a visible error and nonzero exit. Do not guess a base directory, normalize a relative override or fall back to another profile. The private MSI relaunch argument preserves the updated instance's selected absolute profile.

Global and Project command definitions share `desktop.actions` in the Desktop user settings. A missing `projectId` means global; an explicit id binds the command to that Desktop Project, not a path, Session cwd or current selection. Global commands remain usable in every Project and Project commands append without overriding global definitions. Save uses the existing settings draft/confirmation path, refreshes projected menus and never starts a command.

Store VS Code/FrostPi keys as flat dot-delimited names; reserve `desktop.*` for Desktop-only settings. Types/defaults come from `desktopSettingDefinitions` in `apps/desktop/src/shared/desktopSettings.ts`; UI labels/groups must not redefine them. Saving settings must not stop or restart an existing Pi child.

## Application updates

Updates live inside Settings, not a separate shell entry. Their actions are independent of settings Save, and installing must preserve the existing unsaved-settings confirmation. Reading local update state is not a network check; checking and downloading are explicit user actions and must not interrupt Pi work.

Node owns installation admission: every registered Session across all Projects, including stopped Sessions, must be closed; pending New/Resume discovery and pickers also block admission. A UI hint or the normal Exit activity check is not authority. The synchronous empty-set check closes new Session admission for installation; do not add a cancellation/recovery protocol to resume operation after preparation fails. Updates must not close Sessions for the user.

Rust owns one persisted local installer and its version metadata, using the official updater Rust API. Cache writes must be atomic; partial downloads must not become installable. Never grant updater plugin permissions to the renderer: bypassing the finite Node route would bypass Session admission. Installation after restart must use the displayed local version without fetching latest or downloading another package. Validate external inputs, but do not add package audits or extra signature checks beyond the official tool's own behavior.

Wait for Node's successful metadata-drain acknowledgement before calling the updater's Windows `install`, which exits the process. Its synchronous `on_before_exit` is not a substitute for awaiting persistence. A failed save must not start MSI. The installer must outlive Node's kill-on-close Job and preserve the current absolute data profile on automatic relaunch. MSI uses all-user installation with UAC. Update failures must be explicit; do not add automatic recovery, retries or rollback. Process scanning and cross-instance update locks are outside this feature. Keep updater signing private keys outside the application and its data profiles; only the public key is embedded.

## Native authority and delivery

Build provenance is descriptive, not an attestation: a dirty commit does not identify the full source tree, and payload hashes do not prove source-to-binary correspondence. Keep native/GUI verification separate from the Rust-free JS gate so extension-only development does not acquire a Windows toolchain dependency.

Only the Node Desktop backend may request native operations from the Rust host. Before Desktop-specific dispatch, shared client messages must pass shared bridge-version/schema validation; requests targeting a Session must also pass shared Session authorization. The renderer must not gain a direct native-operation API.

The 32 MiB limit applies to Desktop private IPC's UTF-8 JSON body, excluding the newline. It must not change shared attachment validation or VS Code behavior. Reject an otherwise-valid oversized UI submission or generated view without disconnecting the backend or stopping Pi. For an oversized prompt, restore Composer text/images and release pending Send; a rejected snapshot/delta must leave the host's view-delivery cache at its last accepted state.

When an oversized view blocks conversation display, disable only the ClientApp region; Projects and New session remain usable. Remove this block only after a full snapshot is accepted for delivery. A delta or renderer reconnect must not clear it.
