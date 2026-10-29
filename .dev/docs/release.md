---
title: Release Procedure
description: Version authority, verified extension publication, and Windows Desktop candidate evidence and independent release gates.
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

`apps/vscode/package.json` is the product version authority. `pnpm version:set <version>` edits only that manifest; the root and package manifests must not define a duplicate product version. Confirm a version or tag match with `node scripts/version.mjs check [expected-version]`. Do not create a separately tracked Desktop version. Update the root `CHANGELOG.md`. VSIX packaging copies that changelog into the extension, so an app-local changelog is not a second authored source.

A checkpoint, test pass or local candidate does not authorize merging, tagging or publication. Obtain the relevant release decision before those operations. Results identify the tested commit or archive; later source edits require fresh affected checks and a rebuilt deliverable.

## VS Code extension release

1. Set the intended version and confirm supported VS Code/Pi assumptions.
2. Install locked workspace dependencies, run `pnpm check:vscode`, then `pnpm package:vsix` and `pnpm verify:vsix`.
3. Exercise the versioned VSIX in clean local/remote hosts for the affected release paths: conversation, attachments, commands/models, extension input, Stop, restoration, file actions and failures. Packaging alone does not establish runtime or theme compatibility; see [testing evidence boundaries](testing.md#evidence-boundaries).
4. Review user-facing README/screenshots, privacy/security statements, notices and diagnostic output. Check paths and third-party stderr before sharing artifacts.
5. Publish from the tested version commit using the tag workflow below. Do not move a tag after publication.

`pnpm check:vscode` checks shared packages and the extension, excluding Desktop-only lint/types/tests/build. `pnpm package:vsix` builds only the extension and its shared dependencies; it does not require a Desktop build. `pnpm check` covers both products.

Tag publication uses the verified VSIX produced by the workflow. If a manual Marketplace publication is required after publication authorization, publish that existing package with the existing `vsce` entry point instead of rebuilding:

```bash
pnpm --dir apps/vscode exec vsce publish --packagePath ../../artifacts/FrostPi-<version>.vsix
```

`--packagePath` resolves relative to `apps/vscode` when invoked this way; an absolute path also works. This publishes the existing VSIX without rebuilding or repackaging. Authentication must already be configured through vsce's supported mechanism; FrostPi adds no custom local credential handling.

### Tag workflow and publishing credentials

`.github/workflows/release.yml` runs on `v*` tags. It checks the tag against the manifest, runs quality/build/package verification, and creates and verifies the VSIX. Stable `vX.Y.Z` tags publish the same verified VSIX to VS Code Marketplace and Open VSX before creating the GitHub Release. Pre-release tags create GitHub prereleases but do not publish to either registry. A rerun skips an already published version rather than replacing it. GitHub's automatic source archives serve the tag; the repository does not build or upload a source ZIP.

Before a stable tag, configure the `marketplace-publish` GitHub environment:

- `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables, with a matching Microsoft Entra federated identity that has Contributor access to the Marketplace publisher;
- an `OVSX_PAT` secret with access to the Open VSX namespace.

Missing configuration or failed publishing must fail the release. Never store token values in Git, packages, logs or chat. After publication, check the registry pages and installation from VS Code/VSCodium.

## Desktop packaging (Windows x64)

Desktop uses a single Tauri host. The local delivery is an unsigned portable ZIP with no installer or automatic updater. Keep the product version unless a version change was separately requested. Build prerequisites are in [development.md](development.md#product-local-work). Runtime prerequisites are Node 22.19+, Pi and WebView2; Node and Pi must be available to a normal desktop launch.

```bash
pnpm package:desktop
pnpm verify:desktop
pnpm verify:desktop --real-pi
pnpm verify:desktop --native-dialogs
```

Both root `pnpm package:desktop` and Desktop-local `package:app` rebuild the JavaScript outputs and the Rust executable before staging; there is no public staging-only command. Do not edit sources or run competing builds while packaging.

Packaging writes `artifacts/FrostPi-<version>-win32-x64.zip`, which extracts to `FrostPi/FrostPi.exe`. The backend and Pi extensions are ordinary files beside the executable; the renderer is embedded, so a JS-only build does not update the shipped UI. Node, Pi and WebView2 are installed separately. User settings/state remain in `%APPDATA%/FrostPi`; this is installation-free, not portable user data.

`apps/desktop/scripts/packaging.mjs` owns the distribution inventories; `apps/desktop/scripts/archive-contract.mjs` owns the embedded provenance and per-payload hash contract, including the `BUILD_INFO.json` fields and their rules. A dirty build's commit is only a baseline, not a complete source snapshot, and payload hashes detect corruption or mix-ups rather than proving signing, reproducibility or source-to-binary correspondence.

Verification enforces the archive allowlist, embedded version consistency and payload hashes, extracts outside the repository, and runs the actual executable with temporary Projects/profiles and controlled Pi children. `apps/desktop/scripts/verify-package.mjs` owns that flow, including the configured Windows desktop PATH; `apps/desktop/scripts/windows-gui-path.mjs` owns how that PATH is reconstructed. An explicitly supplied archive is checked against its embedded version, not the current checkout's version. Archives without build information fail the current contract; old reports remain historical evidence, not certification by the new verifier.

The adjacent `<archive>.verification.json` records the archive SHA-256, embedded build information and executed check results, including failures and optional checks not requested or not established. A copy remains in the temporary extraction directory. Replacing a ZIP during packaging removes its previous adjacent report and checksum. A ZIP built without verification is a candidate, not a verified deliverable. Optional `--real-pi` additionally checks installed Pi discovery and an isolated extension command/confirmation/custom-message path without a model request; it does not establish real-model or provider acceptance. See [testing evidence boundaries](testing.md#evidence-boundaries).

Rust checks, GUI smoke and packaged verification stay outside the ordinary JavaScript gate and outside extension release checks.

### Independent Desktop release

`.github/workflows/desktop.yml` runs on `v*` tags and manual dispatch. It is independent of the extension workflow: Desktop build, GUI or upload failures must never block extension publication. Shared-code failures can still block the extension's own checks.

The Windows job performs the complete Desktop build, runs Desktop lint/typecheck/tests, Rust checks through `cargo`, and `pnpm verify:desktop` against the extracted ZIP. GUI verification is a hard publication gate, not a best-effort step. Runner limitations fail Desktop verification; do not bypass it with `continue-on-error`, skipped assertions or a static-only substitute. Candidate artifacts and the actual failure report are retained when available. A manual branch run validates a candidate without publishing.

For a tag run, `node apps/desktop/scripts/prepare-release.mjs v<version>` requires a clean Git checkout, matching tag/archive version and source commit, a successful GUI report and an identical ZIP SHA-256. It writes `<archive>.sha256` without rebuilding. The publish job downloads this run's assets, rechecks the checksum and attaches ZIP, checksum and verification report to the same GitHub Release as the extension. It can create that release if the extension has not created it yet; stable/pre-release status follows the tag. Publication requires a successful Windows job and uses `GITHUB_TOKEN` with contents-write and artifact-read permissions, not Marketplace credentials.

Existing Desktop release assets are never overwritten. Uploads handle assets individually: byte-identical existing assets are skipped, missing assets are uploaded, and different bytes under a published name fail. Retrying the publish job can therefore complete a partial upload without replacing its earlier assets; rebuilding the tag may produce different bytes and must not silently replace the published version. Local uncommitted builds can be packaged and GUI-tested but cannot pass release preparation. Hosted GUI capability must be verified by an actual workflow run before claiming automated release acceptance.

The package includes the project license, JS dependency notices, locked Rust dependency license texts and source references. Packaging fails when a Rust dependency lacks an available license text. Windows system runtimes are prerequisites rather than bundled payload. No tag, publication, signing or installer is implied by these commands. Extension publication uses its independent VS Code build and never invokes Rust.
