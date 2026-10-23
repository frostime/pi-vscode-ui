---
title: Release Procedure
description: Versioning, VSIX publication, and explicit Windows Desktop candidate packaging.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /apps/desktop/**
  - /packages/pi-rpc/package.json
updated: 2026-10-23
---

# Release Procedure

## VS Code extension release

1. Set the product version with `pnpm version:set <version>` and update only the root `CHANGELOG.md`. `apps/vscode/package.json` is the version source; packaging copies the root changelog into the VSIX, so do not maintain `apps/vscode/CHANGELOG.md` in git.
2. Confirm supported VS Code and Pi compatibility assumptions.
3. Run `pnpm install --frozen-lockfile` and `pnpm check`.
4. Run `pnpm package:vsix` and `pnpm verify:vsix`.
5. Install the versioned VSIX into clean local and remote hosts; smoke-test prompt, image, command, model, extension UI, stop, restore, diff, and failure paths.
6. Review README, screenshots, privacy documents, notices, and diagnostics for correctness and sensitive content.
7. Before the first automated release, configure the `marketplace-publish` GitHub environment, its `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables, a matching GitHub federated credential on a Microsoft Entra managed identity with Contributor access to the `frostime` Marketplace publisher, and an `OVSX_PAT` Actions secret with access to the `frostime` Open VSX namespace. Do not push a release tag until both publishing identities are ready. Never put tokens in git, VSIX content, logs, or chat.
8. Push a tag `v<version>` on the tested version commit. [The Release workflow](../../.github/workflows/release.yml) checks the tag against the manifest, builds and verifies one VSIX, then publishes that exact file to both registries for stable `vX.Y.Z` tags before creating the GitHub Release. Pre-release `v*` tags still build a GitHub prerelease with artifacts, but do not publish to either registry. Missing configuration or failed publication fails the workflow; a rerun skips already published versions so the other registry can finish. Do not move a tag after publication.
9. Check the version on both registry pages and install from VS Code and VSCodium; packaging verification does not establish runtime compatibility. `pnpm publish:marketplace` remains an opt-in local command, but is not used by the tag workflow.

## Desktop candidate packaging (Windows x64)

This is an explicit local candidate flow, not a Marketplace release, installer, signed build or automatic update channel. Keep the existing product version unless a version change is separately requested. The runtime manifest and archive name derive from `apps/vscode/package.json`; do not add a tracked Desktop version.

Use Windows x64, Node 22.12+ and the locked Electron installation. From the repository root:

```bash
pnpm package:desktop
pnpm verify:desktop
```

The first command builds and writes `artifacts/FrostPi-<version>-win32-x64.zip`; extraction produces `FrostPi/FrostPi.exe`. The staging allowlist contains built application resources, a minimal manifest, instructions and licenses, not workspace sources, development dependencies or user profiles. No ASAR keeps the private Pi artifacts accessible to the external Pi/Node process. Electron is included; Pi and the external Node installation needed to run it are not installed or upgraded by this package.

The second command must verify the actual extracted executable outside the repository, with isolated application/Pi data and an explicit success artifact identifying the archive SHA-256. It verifies that artifact, not arbitrary later source edits: rerun packaging when accepting new runtime code. Archive inspection or process exit 0 alone does not pass. An installed supported Pi can additionally be exercised without model calls using `pnpm verify:desktop --real-pi`; see the test guide for its limited command/UI scope. Preserve the [verification boundaries](testing.md#evidence-boundaries): controlled Pi checks do not establish real-model behavior, signing, every platform or final user experience.

Normal application data remains in the system application-data `FrostPi` profile, not beside the executable. The ZIP is installation-free, not a portable-data mode. Before public distribution, separately review user instructions, applicable licenses, signing/Windows warnings and real GUI operation. Do not silently add Desktop publication to the existing extension release workflow; merge, tag and public release still need user authorization.
