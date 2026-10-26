---
title: Release Procedure
description: Version authority, verified extension publication and explicit Windows Desktop candidate delivery.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /apps/desktop/**
  - /packages/pi-rpc/package.json
updated: 2026-10-24
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

## Desktop candidate packaging (Windows x64)

Desktop currently has an explicit local, unsigned ZIP flow, not an installer or automatic update channel. Keep the current product version unless a version change was separately requested. Use Windows x64, Node 22.12+ and the locked Electron installation.

From the repository root:

```bash
pnpm package:desktop
pnpm verify:desktop
```

Packaging builds `artifacts/FrostPi-<version>-win32-x64.zip`, which extracts to `FrostPi/FrostPi.exe`. Electron is included; external Node and Pi remain machine prerequisites. Application settings/state stay in the system application-data FrostPi profile, not beside the executable. This is installation-free, not USB-portable data. The payload allowlist and native-resource requirements are in `apps/desktop/SPEC.md` under Packaged distribution.

Verification must run the actual extracted executable outside the repository with isolated data and an explicit success artifact identifying the ZIP SHA-256. Archive inspection or exit 0 alone does not pass. The optional `pnpm verify:desktop --real-pi` checks a limited installed-runtime command/UI path; its non-model scope is defined in `.dev/docs/testing.md` under Evidence boundaries.

When handing over a candidate, record its source commit, archive size/hash, the checks actually run and their limits in the relevant change record. Existing extracted directories do not update when a same-named ZIP is rebuilt; tell the user to close the old app and extract the candidate into a new directory.

Public distribution separately requires user-instruction, licence, signing/Windows-warning and real-GUI review. Do not silently add Desktop publication to the extension workflow or treat candidate delivery as merge/publication approval.
