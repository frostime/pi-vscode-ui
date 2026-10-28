# Desktop contracts

## Session and presentation

Store Session-to-Project associations in Desktop navigation metadata. Reassigning a Session to another Project must not change that Session's id or cwd. After Project selection completes, `SessionRegistry.activeSessionId` must name one of that Project's Sessions or be null. Filtering the visible Session list cannot substitute for updating this Registry selection.

While the same Session remains selected, sidebar hide/resize, theme/zoom changes and Resume/transport-limit overlays must not remount ClientApp or Composer or discard its draft. Hiding the Resume overlay alone must not cancel the pending Resume request. Attribute any later result to the Project that initiated that request, even if another Project is now selected.

## Window and application lifetime

Closing the main window hides it to the Windows tray; it must not dispose the backend, stop Pi children or remount ClientApp. The first close in each launch explains the tray behavior. Tray left-click and Show restore the same window and its drafts. Hidden windows report invisible to the backend so restoring them refreshes the shared presentation.

Only explicit Exit ends normal application lifetime. Node checks activity across all Projects, including pending input and process/session operations; the native shell asks for confirmation when that work would be interrupted. Cancelling leaves tasks running. Approval uses the same bounded stop/metadata-drain path as before; renderer/browser failure still terminates through that path rather than hiding a broken window. Exit checks travel over the private shell/backend wire, not the renderer bridge.

## Persistence

Only Session ids admitted by shared `SessionPersistence` may appear in persisted Desktop Session-to-Project mappings or last-viewed selections. Eligibility is defined in `apps/pi-client/src/host/session-lifecycle.SPEC.md`.

Report application shutdown as saved only after Registry session metadata and Desktop navigation metadata have been flushed to `state.json`. A load/validation failure for `settings.json` or `state.json` must preserve the file and block writes until a successful load; never initialize defaults over the failed file.

## Settings and initial import

The development launcher isolates only FrostPi-owned settings/state and WebView2 storage. It must not redirect Pi agent/session directories or copy credentials. Normal packaged launches keep the existing profile, and an explicit `FROSTPI_DESKTOP_USER_DATA` takes precedence in both launch paths.

Store VS Code/FrostPi keys as flat dot-delimited names; reserve `desktop.*` for Desktop-only settings. Types/defaults come from `desktopSettingDefinitions` in `apps/desktop/src/shared/desktopSettings.ts`; UI labels/groups must not redefine them. Saving settings must not stop or restart an existing Pi child.

## Native authority and delivery

Build provenance is descriptive, not an attestation: a dirty commit does not identify the full source tree, and payload hashes do not prove source-to-binary correspondence. Keep native/GUI verification separate from the Rust-free JS gate so extension-only development does not acquire a Windows toolchain dependency.

Only the Node Desktop backend may request native operations from the Rust host. Before Desktop-specific dispatch, shared client messages must pass shared bridge-version/schema validation; requests targeting a Session must also pass shared Session authorization. The renderer must not gain a direct native-operation API.

The 32 MiB limit applies to Desktop private IPC's UTF-8 JSON body, excluding the newline. It must not change shared attachment validation or VS Code behavior. Reject an otherwise-valid oversized UI submission or generated view without disconnecting the backend or stopping Pi. For an oversized prompt, restore Composer text/images and release pending Send; a rejected snapshot/delta must leave the host's view-delivery cache at its last accepted state.

When an oversized view blocks conversation display, disable only the ClientApp region; Projects and New session remain usable. Remove this block only after a full snapshot is accepted for delivery. A delta or renderer reconnect must not clear it.
