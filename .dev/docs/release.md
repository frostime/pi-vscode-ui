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
updated: 2026-11-03
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

Desktop supports an MSI for all users with in-app updates and the existing portable ZIP. Build prerequisites are in [development.md](development.md#product-local-work); recipients need Node 22.19+, Pi and WebView2, with Node/Pi available to a normal desktop launch. MSI does not install those runtimes. Settings stay in `%APPDATA%/FrostPi` unless explicitly overridden; updating program files must not remove the profile or Pi history.

```bash
pnpm package:desktop
pnpm verify:desktop
```

Both root `package:desktop` and Desktop-local `package:app` rebuild JS and Rust before staging. There is no public staging-only shortcut; do not edit sources or run competing builds during packaging. Output is `artifacts/FrostPi-<version>-win32-x64.zip`, extracting to `FrostPi/`. Keep the folder intact: backend/Pi extensions accompany the exe, while the renderer is embedded.

`packaging.mjs` and `archive-contract.mjs` under `apps/desktop/scripts/` own the inventory and embedded build information. The commit/dirty state and payload hashes describe provenance; a dirty commit is only a baseline, and hashes do not prove signing, reproducibility or source-to-binary correspondence.

Verification checks the allowlist, embedded version and hashes, then runs the extracted exe outside the checkout using the configured Windows desktop PATH, temporary data and controlled Pi. An explicit archive is checked against its own version, not the checkout. Archives lacking build information fail the current contract.

The adjacent `<archive>.verification.json` binds locally executed results and optional checks to the ZIP SHA-256. Replacing the ZIP removes its previous report/checksum. Static archive checks do not establish GUI behavior. Optional `--real-pi`/`--native-dialogs` behavior and evidence limits are in [testing.md](testing.md#real-host-verification).

Packaging includes project/JS/Rust license notices and source references, and fails when a locked Rust dependency's license text is unavailable. System runtimes are not bundled.

### MSI and update signing

```bash
pnpm package:desktop:msi
```

The MSI build needs `FROSTPI_UPDATE_PUBLIC_KEY` (public), `TAURI_SIGNING_PRIVATE_KEY` (secret) and, when used, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (secret). The public key is embedded by the same Tauri configuration override used to compile the EXE. Ordinary `build:desktop` and ZIP packaging need no keys and leave updates disabled. Do not generate a new key per build: existing clients must continue to trust the signing identity. Private-key creation, backup and CI setup are release-operator responsibilities, outside the checkout and application profiles.

`package-msi.mjs` rebuilds JS/Rust, stages matching runtime resources and license notices, builds MSI and invokes the official Tauri signer. Compiler/build subprocesses do not receive private signing material. `packaging.mjs` owns common resource metadata; `msi-contract.mjs` checks necessary release inputs and writes the update manifest atomically. MSI packaging does not produce provenance records, payload hash ledgers or separate signature audits.

Outputs are `FrostPi-<version>-win32-x64.msi`, `.msi.sig` and `FrostPi-desktop-update.json` under `artifacts/`. The update target is `windows-x86_64-msi`; the stable endpoint is the latest GitHub Release's `FrostPi-desktop-update.json`. The application persists one downloaded version atomically and uses it after restart without fetching latest or downloading again during installation. Official updater behavior is retained; FrostPi does not add an attacked/tampered-package guarantee.

MSI installs for all users and requests administrator approval. Updates require every Desktop Session to be closed, save state before starting Windows Installer, and automatically reopen with the same data profile. Users must close other instances manually; FrostPi does not scan processes or coordinate updates across profiles. Windows Authenticode is separate from the updater signature: without an Authenticode certificate, Windows may still display an unknown-publisher warning. Exit the old ZIP-only app before the first manual MSI installation; those versions cannot enter this update chain without that manual upgrade.

For a tag, `node apps/desktop/scripts/prepare-msi-release.mjs v<version>` checks the tag/version, nonempty installer and matching manifest target, URL and signature value. It does not rebuild, audit provenance, verify cryptography or establish installation acceptance.

### Independent Desktop release

Test Desktop locally **before pushing the release tag**. Run the affected automated tests locally, package the intended source commit and run `pnpm verify:desktop`. Manual acceptance of the extracted ZIP is also sufficient for the ZIP: confirm startup, send/reply, Stop, project/session switching, persistence after reopening and tray Exit/confirmation. Use the [manual acceptance procedure](testing.md#windows-native-evidence) for isolated data, and record the source commit, ZIP SHA and observed results in the change record. MSI additionally needs one isolated real old-version → new-version upgrade, confirming data retention, application usability, all-user/UAC installation and automatic reopen into the same profile. Also confirm Session admission and offline installation of the persisted local version. This change's real two-version upgrade is not yet verified; building or extracting MSI does not establish it. Cancellation recovery, rollback and package audits are not acceptance requirements. Do not use the production product identity, installation directory or user profile for destructive upgrade/uninstall tests. A timeout or a closed test window alone is not a passed manual test.

`.github/workflows/desktop.yml` handles tags and manual dispatch independently of extension publication. The hosted job only compiles, packages and uploads Desktop; it does not run lint, typechecks, unit tests, Rust tests or GUI smoke. Local pre-release acceptance is the test gate. Do not reintroduce hosted test gates without a separate decision to change this release policy. Build, archive-integrity and upload errors still fail publication; manual branch dispatch only packages a candidate without publishing.

Configure the repository variable `FROSTPI_UPDATE_PUBLIC_KEY` and the two signing secrets above before running the workflow. MSI packaging fails explicitly if its configuration is missing; it does not create or load key files. Portable ZIP output remains separate.

For tags, `node apps/desktop/scripts/prepare-release.mjs v<version>` checks archive inventory, payload hashes, version, clean source state and matching source commit. It writes `<archive>.sha256` without rebuilding or requiring a GUI report. Dirty local builds may be packaged/tested but cannot pass release preparation.

CI rebuilds from the tag, so local acceptance covers the tested source/local ZIP, not the exact CI-produced bytes. The hosted ZIP has static archive checks only; do not call it GUI-verified or attach a local verification report to it.

The publish job downloads this run's assets, rechecks the existing ZIP checksum and attaches ZIP/checksum and MSI/signature to the same GitHub Release as the extension, creating it if necessary. It uploads the update JSON last, only after the corresponding MSI and signature exist. Stable/prerelease status follows the tag. It uses `GITHUB_TOKEN`, not Marketplace credentials; workflow permissions are declared in the YAML.

Published assets are immutable: skip byte-identical assets, upload missing ones, and fail on different bytes under an existing name. Upload retries can complete partial publication; rebuilding a tag may change bytes and must not replace published files.

To supplement an existing release, an explicitly authorized local upload may attach a locally accepted ZIP with `gh release upload <tag> <zip> <zip>.sha256`. Validate its archive/version and clean embedded source first. The source commit must match the tag, or have an identical Git tree (for example, a release merge with unchanged contents); record that comparison and the archive SHA. Upload the successful `<zip>.verification.json` only when it belongs to those exact bytes. Do not move the tag, rebuild after acceptance or use `--clobber` to replace existing assets.
