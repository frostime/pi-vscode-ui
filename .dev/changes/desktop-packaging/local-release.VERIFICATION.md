# Local acceptance and Desktop release supplement

## Decision

The user authorized moving Desktop acceptance out of hosted publication, then testing, committing and supplementing the existing `v0.16.0` GitHub Release with `gh`. Extension publication stays unchanged. Desktop CI compiles/packages, checks archive integrity and uploads ZIP/checksum; it no longer runs lint, typechecks, unit/Rust tests or GUI smoke. Local automated verification or recorded manual acceptance is required before release.

## Candidate and source identity

The existing clean local ZIP is used without rebuilding:

- Archive: `artifacts/FrostPi-0.16.0-win32-x64.zip`
- SHA-256: `a09ab20458b13592b54dc8de1342d8053e3a621391bc570391bafccc54590ad3`
- Embedded source commit: `44ac6a42f9a7eb67691a8a2e7883994579a449f0`, `dirty: false`
- Existing `v0.16.0` tag commit: `8dbfde8a0ce12b1ed1e58ee8668efea5ff0b757a`
- Both Git trees: `092dfc58870e9264f8bab27f92515dd0ca0c46f4`

`git diff --quiet 44ac6a42f9a7eb67691a8a2e7883994579a449f0 v0.16.0` exited 0. The release merge changed commit identity, not source contents. This permits adding the clean local candidate to the existing release without moving its tag. Later CI-policy/test-only changes are not claimed to be embedded in this ZIP.

## Verification

- `pnpm --dir apps/desktop test`: 20 files, 171 tests passed with the release-policy changes.
- Focused ESLint on `scripts/prepare-release.mjs` and `test/packaging.test.mjs`: passed.
- Workflow YAML/trigger/asset checks and upload shell syntax: passed. No hosted workflow execution is claimed.
- `pnpm verify:desktop <absolute archive path>`: passed at `2026-10-30T14:48:02.169Z`, with archive and GUI smoke marked passed for the SHA above.
- The native smoke completed 14 checks, including shared UI/IPC, controlled Pi send, Mermaid, hide/restore, oversized-message rejection, concurrent Projects/Stop, Resume/history, settings/IME/zoom, persistence/reopening and process cleanup.
- Real-provider/model calls and opt-in native dialogs were not requested. Tray right-click Exit/confirmation remains a manual check, not a passed automated result.

At this record's creation, upload has not yet occurred. Successful attachment must be confirmed against the remote asset names, sizes and digests; this document alone is not publication evidence. Never overwrite the existing VSIX or move the published tag.
