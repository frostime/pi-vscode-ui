---
title: Release Procedure
description: Versioning, quality gates, VSIX inspection, and Marketplace/Open VSX publication.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /packages/pi-rpc/package.json
updated: 2026-09-28
---

# Release Procedure

1. Set the product version with `pnpm version:set <version>` and update only the root `CHANGELOG.md`. `apps/vscode/package.json` is the version source; packaging copies the root changelog into the VSIX, so do not maintain `apps/vscode/CHANGELOG.md` in git.
2. Confirm supported VS Code and Pi compatibility assumptions.
3. Run `pnpm install --frozen-lockfile` and `pnpm check`.
4. Run `pnpm package:vsix` and `pnpm verify:vsix`.
5. Install the versioned VSIX into clean local and remote hosts; smoke-test prompt, image, command, model, extension UI, stop, restore, diff, and failure paths.
6. Review README, screenshots, privacy documents, notices, and diagnostics for correctness and sensitive content.
7. Before the first automated release, configure the `marketplace-publish` GitHub environment, its `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` variables, a matching GitHub federated credential on a Microsoft Entra managed identity with Contributor access to the `frostime` Marketplace publisher, and an `OVSX_PAT` Actions secret with access to the `frostime` Open VSX namespace. Do not push a release tag until both publishing identities are ready. Never put tokens in git, VSIX content, logs, or chat.
8. Push a tag `v<version>` on the tested version commit. [The Release workflow](../../.github/workflows/release.yml) checks the tag against the manifest, builds and verifies one VSIX, then publishes that exact file to both registries for stable `vX.Y.Z` tags before creating the GitHub Release. Pre-release `v*` tags still build a GitHub prerelease with artifacts, but do not publish to either registry. Missing configuration or failed publication fails the workflow; a rerun skips already published versions so the other registry can finish. Do not move a tag after publication.
9. Check the version on both registry pages and install from VS Code and VSCodium; packaging verification does not establish runtime compatibility. `pnpm publish:marketplace` remains an opt-in local command, but is not used by the tag workflow.
