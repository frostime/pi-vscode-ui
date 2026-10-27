---
title: Release Procedure
description: Version authority, verified extension publication and Windows Desktop ZIP delivery.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /apps/desktop/**
  - /packages/pi-rpc/package.json
updated: 2026-10-27
---

# Release Procedure

## Version and authorization

`apps/vscode/package.json` is the product version authority. Use `pnpm version:set <version>` to update the related manifests; do not create a separately tracked Desktop version. Update the root `CHANGELOG.md`. VSIX packaging copies that changelog into the extension, so an app-local changelog is not a second authored source.

A checkpoint, test pass or local candidate does not authorize merging, tagging or publication. Obtain the relevant release decision before those operations. Results identify the tested commit or archive; later source edits require fresh affected checks and a rebuilt deliverable.

## VS Code extension release

1. Set the intended version and confirm supported VS Code/Pi assumptions.
2. Install locked workspace dependencies, run `pnpm check`, then `pnpm package:vsix` and `pnpm verify:vsix`.
3. Exercise the versioned VSIX in clean local/remote hosts for the affected release paths: conversation, attachments, commands/models, extension input, Stop, restoration, file actions and failures. Packaging alone does not establish runtime or theme compatibility; see `.dev/docs/testing.md` for evidence boundaries.
4. Review user-facing README/screenshots, privacy/security statements, notices and diagnostic output. Check paths and third-party stderr before sharing artifacts.
5. Publish from the tested version commit using the tag workflow below. Do not move a tag after publication.

`pnpm package:vsix` and `pnpm publish:marketplace` build only the extension and its shared dependencies through `apps/vscode`'s build script. They do not require a Desktop build. Root `pnpm build` and `pnpm check` continue to cover both products.

### Tag workflow and publishing credentials

`.github/workflows/release.yml` runs on `v*` tags. It checks the tag against the manifest, runs quality/build/package verification, and creates the VSIX and source archive. Stable `vX.Y.Z` tags publish the same verified VSIX to VS Code Marketplace and Open VSX before creating the GitHub Release. Pre-release tags create GitHub prereleases but do not publish to either registry. A rerun skips an already published version rather than replacing it.

Before a stable tag, configure the `marketplace-publish` GitHub environment:

- `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables, with a matching Microsoft Entra federated identity that has Contributor access to the Marketplace publisher;
- an `OVSX_PAT` secret with access to the Open VSX namespace.

Missing configuration or failed publishing must fail the release. Never store token values in Git, packages, logs or chat. `pnpm publish:marketplace` is an opt-in local path, not the tag workflow. After publication, check the registry pages and installation from VS Code/VSCodium.

## Desktop packaging (Windows x64)

Desktop uses a single Tauri host. The local delivery is an unsigned portable ZIP with no installer or automatic updater. Keep the product version unless a version change was separately requested. Native builds require Windows x64, Rust MSVC, Visual Studio C++ build tools/Windows SDK, and WebView2. Runtime prerequisites are Node 22.19+, Pi and WebView2; Node and Pi must be available to a normal desktop launch.

```bash
pnpm package:desktop
pnpm verify:desktop
pnpm verify:desktop --real-pi
pnpm verify:desktop --native-dialogs
```

Packaging builds `artifacts/FrostPi-<version>-win32-x64.zip`, which extracts to `FrostPi/FrostPi.exe`. The backend and Pi extensions are ordinary files beside the executable; the renderer is embedded. Node, Pi and WebView2 are installed separately. User settings/state remain in `%APPDATA%/FrostPi`; this is installation-free, not portable user data. `apps/desktop/scripts/package-app.mjs` stages the payload; `apps/desktop/scripts/verify-package.mjs` enforces the archive allowlist.

Verification enforces the archive allowlist and version, extracts outside the repository, reconstructs the configured Windows machine/user PATH and runs the actual executable using temporary Projects/profiles and controlled Pi children. It records the archive SHA-256 and explicit native smoke results. Optional `--real-pi` additionally checks installed Pi discovery and an isolated extension command/confirmation/custom-message path without a model request. It does not establish real-model or provider acceptance; see [testing evidence boundaries](testing.md#evidence-boundaries).

The package includes the project license, JS dependency notices, locked Rust dependency license texts and source references. Packaging fails when a Rust dependency lacks an available license text. Windows system runtimes are prerequisites rather than bundled payload. No tag, publication, signing or installer is implied by these commands. Extension publication uses its independent VS Code build and never invokes Rust.
