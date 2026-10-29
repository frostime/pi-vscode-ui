---
title: Release Procedure
description: Version authority, verified extension publication and independent Windows Desktop delivery.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /apps/desktop/**
  - /packages/pi-rpc/package.json
updated: 2026-10-29
---

# Release Procedure

## Version and authorization

`apps/vscode/package.json` is the sole product version authority. Use `pnpm version:set <version>`; confirm a tag/version with `node scripts/version.mjs check [expected-version]`. Do not track a separate Desktop version. Edit the root `CHANGELOG.md`; VSIX packaging copies it into the extension rather than maintaining a second authored copy.

Tests, checkpoints and local candidates do not authorize merging, tagging or publication. Obtain that decision separately. Results identify a commit/archive; later source changes need affected checks and a rebuilt deliverable. Do not move published tags.

## VS Code extension release

1. Set the intended version and confirm supported VS Code/Pi assumptions.
2. Install locked dependencies, then run `pnpm check:vscode`, `pnpm package:vsix` and `pnpm verify:vsix`. These exclude Desktop; packaging rebuilds shared dependencies and the extension.
3. Exercise the versioned VSIX in clean local/remote hosts for affected runtime paths. Packaging alone does not establish GUI, theme or model compatibility; see [testing evidence](testing.md#evidence-boundaries).
4. Review README/screenshots, privacy/security statements, notices and diagnostics for publication, then use the tested version commit for the tag workflow.

If authorized manual Marketplace publication is needed, publish the existing verified VSIX rather than rebuilding:

```bash
pnpm --dir apps/vscode exec vsce publish --packagePath ../../artifacts/FrostPi-<version>.vsix
```

The path is relative to `apps/vscode` (or use an absolute path). Configure authentication through vsce; FrostPi adds no local credential handling.

### Tag workflow and publishing credentials

`.github/workflows/release.yml` handles `v*` tags: check the tag version, run extension checks, build and verify the VSIX. Stable `vX.Y.Z` tags publish that same VSIX to Marketplace and Open VSX, then create the GitHub Release. Other valid version tags create GitHub prereleases without registry publication. Reruns skip an already published version; source downloads use GitHub's tag archives.

Stable publication requires the `marketplace-publish` GitHub environment:

- `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables with an Entra federated identity holding Contributor access to the Marketplace publisher;
- `OVSX_PAT` with access to the Open VSX namespace.

Missing configuration or failed publication fails the release. Never put tokens in Git, packages, logs or chat. Check registry pages and installation from VS Code/VSCodium after publication.

## Desktop packaging (Windows x64)

Delivery is an unsigned portable ZIP, without an installer or updater. Build prerequisites are in [development.md](development.md#product-local-work); recipients need Node 22.19+, Pi and WebView2, with Node/Pi available to a normal desktop launch. Settings stay in `%APPDATA%/FrostPi`: installation-free does not mean portable user data.

```bash
pnpm package:desktop
pnpm verify:desktop
```

Both root `package:desktop` and Desktop-local `package:app` rebuild JS and Rust before staging. There is no public staging-only shortcut; do not edit sources or run competing builds during packaging. Output is `artifacts/FrostPi-<version>-win32-x64.zip`, extracting to `FrostPi/`. Keep the folder intact: backend/Pi extensions accompany the exe, while the renderer is embedded.

`packaging.mjs` and `archive-contract.mjs` under `apps/desktop/scripts/` own the inventory and embedded build information. The commit/dirty state and payload hashes describe provenance; a dirty commit is only a baseline, and hashes do not prove signing, reproducibility or source-to-binary correspondence.

Verification checks the allowlist, embedded version and hashes, then runs the extracted exe outside the checkout using the configured Windows desktop PATH, temporary data and controlled Pi. An explicit archive is checked against its own version, not the checkout. Archives lacking build information fail the current contract.

The adjacent `<archive>.verification.json` binds executed results and optional checks to the ZIP SHA-256. Replacing the ZIP removes its previous report/checksum. A package without successful verification is a candidate, not a verified deliverable; static checks cannot substitute for GUI verification. Optional `--real-pi`/`--native-dialogs` behavior and evidence limits are in [testing.md](testing.md#real-host-verification).

Packaging includes project/JS/Rust license notices and source references, and fails when a locked Rust dependency's license text is unavailable. System runtimes are not bundled.

### Independent Desktop release

`.github/workflows/desktop.yml` handles tags and manual dispatch independently: Desktop failures must not block extension publication. Shared-code failures can still block the extension's own checks. Manual branch dispatch validates a candidate without publishing.

The Windows job packages, checks Desktop JS/Rust and runs `verify:desktop`. Automated GUI success is a hard publication gate; runner limitations must fail it, not trigger skipped assertions or static-only acceptance. Tray menu Exit/confirmation are separate manual checks listed by the runner; record them for the candidate using the [testing procedure](testing.md#windows-native-evidence). Preserve candidate artifacts and actual failure reports. Hosted GUI acceptance can only be claimed after an actual successful workflow run.

For tags, `node apps/desktop/scripts/prepare-release.mjs v<version>` requires a clean checkout, matching tag/archive version and source commit, and a successful GUI report for the identical ZIP SHA-256. It writes `<archive>.sha256` without rebuilding. Dirty local builds may be packaged/tested but cannot pass this release preparation.

The publish job downloads this run's assets, rechecks the checksum and attaches ZIP/checksum/report to the same GitHub Release as the extension, creating it if necessary. Stable/prerelease status follows the tag. It uses `GITHUB_TOKEN`, not Marketplace credentials; workflow permissions are declared in the YAML.

Published assets are immutable: skip byte-identical assets, upload missing ones, and fail on different bytes under an existing name. Upload retries can complete partial publication; rebuilding a tag may change bytes and must not replace published files.
