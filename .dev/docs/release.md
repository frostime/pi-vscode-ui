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
updated: 2026-10-30
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

The adjacent `<archive>.verification.json` binds locally executed results and optional checks to the ZIP SHA-256. Replacing the ZIP removes its previous report/checksum. Static archive checks do not establish GUI behavior. Optional `--real-pi`/`--native-dialogs` behavior and evidence limits are in [testing.md](testing.md#real-host-verification).

Packaging includes project/JS/Rust license notices and source references, and fails when a locked Rust dependency's license text is unavailable. System runtimes are not bundled.

### Independent Desktop release

Test Desktop locally **before pushing the release tag**. Run the affected automated tests locally, package the intended source commit and run `pnpm verify:desktop`. Manual acceptance of the extracted ZIP is also sufficient: confirm startup, send/reply, Stop, project/session switching, persistence after reopening and tray Exit/confirmation. Use the [manual acceptance procedure](testing.md#windows-native-evidence) for isolated data, and record the source commit, ZIP SHA and observed results in the change record. A timeout or a closed test window alone is not a passed manual test.

`.github/workflows/desktop.yml` handles tags and manual dispatch independently of extension publication. The hosted job only compiles, packages and uploads Desktop; it does not run lint, typechecks, unit tests, Rust tests or GUI smoke. Local pre-release acceptance is the test gate. Do not reintroduce hosted test gates without a separate decision to change this release policy. Build, archive-integrity and upload errors still fail publication; manual branch dispatch only packages a candidate without publishing.

For tags, `node apps/desktop/scripts/prepare-release.mjs v<version>` checks archive inventory, payload hashes, version, clean source state and matching source commit. It writes `<archive>.sha256` without rebuilding or requiring a GUI report. Dirty local builds may be packaged/tested but cannot pass release preparation.

CI rebuilds from the tag, so local acceptance covers the tested source/local ZIP, not the exact CI-produced bytes. The hosted ZIP has static archive checks only; do not call it GUI-verified or attach a local verification report to it.

The publish job downloads this run's assets, rechecks the checksum and attaches ZIP/checksum to the same GitHub Release as the extension, creating it if necessary. Stable/prerelease status follows the tag. It uses `GITHUB_TOKEN`, not Marketplace credentials; workflow permissions are declared in the YAML.

Published assets are immutable: skip byte-identical assets, upload missing ones, and fail on different bytes under an existing name. Upload retries can complete partial publication; rebuilding a tag may change bytes and must not replace published files.

To supplement an existing release, an explicitly authorized local upload may attach a locally accepted ZIP with `gh release upload <tag> <zip> <zip>.sha256`. Validate its archive/version and clean embedded source first. The source commit must match the tag, or have an identical Git tree (for example, a release merge with unchanged contents); record that comparison and the archive SHA. Upload the successful `<zip>.verification.json` only when it belongs to those exact bytes. Do not move the tag, rebuild after acceptance or use `--clobber` to replace existing assets.
