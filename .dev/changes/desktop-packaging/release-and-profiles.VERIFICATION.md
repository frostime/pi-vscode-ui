# Release/profile follow-up verification — 2026-10-28

Verification ran on uncommitted changes based on `7e247accb506f20fc803b18bfe545e6416b88255`. The user subsequently authorized committing the completed changes after reporting normal manual operation. Product version is unchanged (`0.15.5`). No tags, pushes, hosted runs or publication were performed.

## Passed

- Final `VITEST_MAX_WORKERS=2 pnpm check`: complete; 1006 tests (43 RPC, 162 provider usage, 297 shared client, 334 extension/shared UI, 170 Desktop). Existing Svelte accessibility warning remains, with zero typecheck errors. Earlier unrestricted run timed out and reported worker exits; the bounded rerun passed without changing test logic.
- `VITEST_MAX_WORKERS=2 pnpm check:vscode`: complete; 836 tests; no Desktop package invocation in its log. This directly checks the extension release's new scope.
- Focused packaging/release/manual/profile suite: 19 tests passed, including exact ZIP/report binding, dirty/tag/commit mismatch rejection, controlled manual setup, same-profile reopen and changed-ZIP rejection.
- `pnpm check:desktop:native`: compile check and native launcher test passed earlier in this change. No Rust product code was changed afterward.
- Latest `pnpm package:desktop`: JS/native build and ZIP creation passed.
- Desktop workflow YAML parsed, Bash upload syntax checked, extension workflow independently selects `check:vscode`, and publish job depends on the successful Windows job including GUI verification.
- Upload script was extracted from workflow YAML and exercised against a temporary fake `gh` boundary: partial upload sends only missing assets; identical retry sends nothing; different published bytes fail without replacement. MSYS lacks `cmp`, so this local test supplied a byte-equivalent Python comparator; the production Ubuntu step uses its normal `cmp`. No GitHub API writes were performed.

## GUI observations and remaining blocker

The send helper had a reproducible time-of-check/time-of-use race: the first of five original runs observed stopped/startup transition, no click event and no controlled Pi prompt. Checking enabled state and clicking in the same renderer task passed five fresh-profile runs, including stopped-state startup cases. No product sending code changed.

One full actual packaged-GUI experiment passed all existing scenarios, including tray hide/restore, confirmation, reopen and crash cleanup. The later rebuilt ZIP is not accepted as stably GUI-verified:

- ZIP: `artifacts/FrostPi-0.15.5-win32-x64.zip`
- SHA-256: `c114fad5625a9b7c7692e8b60c607c1a995c3a6c44bd709b3732b40ab10b951f`
- Source metadata: baseline above, dirty build.
- First run failed at synthetic tray restore (`frostpi-tauri-smoke-f9wrFC`). Its original diagnostic queried id 1; that value is not evidence about the real icon and was corrected.
- Source inspection showed pinned Tauri 2.12.5 allocates a default logical id, then tray-icon 0.25.1 allocates native id 2. The corrected diagnostic run (`frostpi-tauri-smoke-K5I6ii`) passed through initial tray behavior, settings, confirmed Exit and reopen, then failed to open the reopened tray menu. `Shell_NotifyIconGetRect` returned 1 both before and after the synthetic click for the actual icon id.
- The pinned dependency accepts only S_OK (0); another result returns before dispatching the tray event/menu. Thus the synthetic action was dropped. Hidden/overflow icon placement is a leading explanation, not a confirmed final diagnosis. Real human clicks are needed.

Microsoft API documentation was fetched successfully with the web helper's direct-access mode; it specifies S_OK success but does not explain result 1. A Stack Overflow answer retrieved through Stack Exchange's API reports result 1 for overflow-hidden icons on Windows 10; treat that as supporting experience, not an authoritative Windows-wide contract. Local source evidence and metadata are in ignored `tmp/shell-tray-*` artifacts.

Do not replace the failed adjacent report with a manually invented automatic pass. The independent Desktop publisher remains fail-closed; extension publication does not depend on it.

## Human acceptance

The task-local procedure is [manual-acceptance.SOP.md](manual-acceptance.SOP.md). `pnpm test:desktop:manual` validates/extracts the current ZIP, creates temporary FrostPi/Pi data and controlled fixtures, and prints the ZIP hash. `--reopen` reuses that test profile only for the same ZIP. It does not certify GUI success or publish assets. Normal development startup continues to isolate only FrostPi-owned data and does not redirect the user's Pi environment.

The user reported that operation looked normal and supplied logs from both `pnpm test:desktop:manual` and `--reopen`. Both identify ZIP SHA-256 `c114fad5625a9b7c7692e8b60c607c1a995c3a6c44bd709b3732b40ab10b951f`, reuse `C:/Users/EEG/AppData/Local/Temp/frostpi-desktop-manual-NoVnWK/profile`, and exit with code 0. Record this as human-observed normal operation, including startup, exit and reopen; do not infer separately itemized checklist results or convert the failed automatic report to a pass. No additional form or unattended GUI retry is required for this feedback.

## Evidence locations

Ignored `tmp/desktop-release-final-check.log`, `tmp/desktop-release-vscode-check.log`, `tmp/desktop-manual-tests.log`, `tmp/desktop-upload-test.log`, `tmp/desktop-release-verify-diagnostic.log`; adjacent candidate verification JSON; temporary GUI result directories named above. Initial hardening evidence remains separately recorded in `VERIFICATION.md`.
