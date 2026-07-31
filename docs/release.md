---
title: Release Procedure
description: Versioning, quality gates, VSIX inspection, and Marketplace/Open VSX publication.
scope:
  - /scripts/**
  - /.github/workflows/**
  - /package.json
  - /apps/vscode/package.json
  - /packages/pi-rpc/package.json
updated: 2026-07-28
---

# Release Procedure

1. Set the product version with `pnpm version:set <version>` and update only the root `CHANGELOG.md`. `apps/vscode/package.json` is the version source; packaging copies the root changelog into the VSIX, so do not maintain `apps/vscode/CHANGELOG.md` in git.
2. Confirm supported VS Code and Pi compatibility assumptions.
3. Run `pnpm install --frozen-lockfile` and `pnpm check`.
4. Run `pnpm package:vsix` and `pnpm verify:vsix`.
5. Install the versioned VSIX into clean local and remote hosts; smoke-test prompt, image, command, model, extension UI, stop, restore, diff, and failure paths.
6. Review README, screenshots, privacy documents, notices, and diagnostics for correctness and sensitive content.
7. Publish with `pnpm publish:marketplace`; it writes `artifacts/FrostPi-<version>.vsix`. Provide `VSCE_PAT` or use prior `vsce login frostime`, pass extra vsce flags after `--`, and publish that same VSIX to Open VSX with `ovsx`.
8. Tag the matching commit and attach the VSIX plus source archive, or use the tag-triggered Release workflow artifacts.

Publisher credentials belong in CI secret storage. The repository and extension package never contain tokens.
