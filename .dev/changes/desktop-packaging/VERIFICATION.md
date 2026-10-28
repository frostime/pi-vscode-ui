# Desktop packaging verification — 2026-10-28

Initial verification ran on uncommitted changes based on `7e247accb506f20fc803b18bfe545e6416b88255`. Product version remains `0.15.5`. No publication or hosted workflow execution was performed. Follow-up implementation and human-test results are recorded in `release-and-profiles.VERIFICATION.md`.

## Passed checks

- Final `pnpm check`: all gates passed; 995 tests across five packages. The pre-existing shared `ExtensionUiRequestCard.svelte` accessibility warning remains (zero typecheck errors).
- Packaging suite: 8 tests, including missing/extra files, changed backend hashes, historical embedded version, unknown/clean/dirty Git provenance, stale success-report replacement and structured native launch failure. The invalid-executable fixture never opens a GUI or starts Pi.
- `pnpm check:desktop:native`: Cargo compile check and the native launch test passed.
- Root `pnpm package:desktop` and Desktop-local `pnpm --dir apps/desktop package:app`: both rebuilt JS and the native executable before creating the ZIP.
- Static verification of the actual ZIP: exact file inventory, embedded metadata/version, ten payload SHA-256 values and native notices passed.
- Desktop workflow YAML parsed locally; manual trigger and Windows candidate-only steps checked. This does not establish GitHub runner execution.
- `git diff --check` passed.

## GUI acceptance did not pass

Two executions of `pnpm verify:desktop` used the same ZIP:

- Archive: `artifacts/FrostPi-0.15.5-win32-x64.zip`
- SHA-256: `a16792ac557f59b52ccb2b9e472b29765100f6c0a984421cdf5899fbca83defc`
- Embedded source: baseline above, `dirty: true`; this is not an exact source snapshot.

First attempt passed window/client mounting, controlled prompt, Mermaid, tray hide/restore, Exit cancellation/confirmation, message limits, concurrent Projects, Resume, settings and reopen. It then failed when the native test helper could not open the reopened process's tray menu. Raw result: `C:/Users/EEG/AppData/Local/Temp/frostpi-tauri-smoke-GZSyc7/result.json`.

Second attempt timed out at `conversation round trip`. Raw result: `C:/Users/EEG/AppData/Local/Temp/frostpi-tauri-smoke-nSIXMO/result.json`. The differing failures do not establish either an environment problem or a product defect. No scenario was skipped and no tray/session implementation was changed to obtain a pass.

The adjacent ZIP report records `ok: false`, archive validation passed and smoke failed. Real Pi and foreground file-dialog checks were not requested. Do not treat this ZIP as a GUI-verified deliverable.

After these runs, the smoke runner was updated to emit its existing failure details as JSON, so future adjacent reports can retain the actual cause and partial check list. The invalid-executable integration test verifies this reporting path; the real GUI suite was not retried again after that reporting-only edit.

## Local evidence

Routine logs are in ignored `tmp/desktop-packaging-*.log`. The first adjacent report was preserved as `tmp/desktop-packaging-verification-first.json` before the second run. The latest adjacent report is `artifacts/FrostPi-0.15.5-win32-x64.zip.verification.json`. Temporary evidence may be cleaned independently; it is not a reusable module contract.
