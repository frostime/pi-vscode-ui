---
name: dual-maintenance
description: Use when maintaining FrostPi's VS Code extension, shared pi-client, or Desktop adapter. Route changes to their source owner, identify whether Desktop adaptation is needed, and choose focused verification without requiring Desktop for plugin-only work.
---

# Dual-product maintenance

VS Code is the reference product; Desktop consumes the same application implementation. Start with the [feature map](../../../.dev/docs/feature-map.md) and the affected module SPEC. This skill routes work; it does not replace those contracts.

## Locate the owner and first check

Paths and commands below are repository-root-relative. Replace test placeholders with the affected files.

| Change | Source owner | First verification |
|---|---|---|
| Shared conversation, tools, Markdown, Composer, theme primitives | `apps/pi-client/src/ui` | Existing DOM tests under `apps/vscode/test/unit`: `pnpm --dir apps/vscode exec vitest run <affected.dom.test.ts>`; shared UI typecheck |
| Shared Runtime, Registry, bridge, or message contracts | `apps/pi-client/src/core`, `src/host`, `src/shared` | `pnpm --dir apps/pi-client exec vitest run <affected-test>`; affected product typechecks when the contract changes |
| VS Code editor/native integration | `apps/vscode` | Focused plugin tests, `pnpm --dir apps/vscode typecheck` and plugin build; Desktop need not run unless a shared contract changed |
| Desktop window, Projects, native interaction, settings | `apps/desktop` | Focused Desktop tests and typecheck; build/smoke for renderer, IPC, launch or native dependency changes |
| Desktop distribution, packaged launch or resources | `apps/desktop/scripts`, Desktop main assembly | `pnpm package:desktop` then `pnpm verify:desktop`; optional `--real-pi` checks the installed SDK command/UI path without model calls; see release/testing boundaries |
| Pi transport/runtime dialect | `packages/pi-rpc` plus affected client consumer | Package-local tests and the [compatibility guide](../../../.dev/docs/protocol/pi-rpc-compatibility.md) |

Use [development.md](../../../.dev/docs/development.md) for exact package scripts and [testing.md](../../../.dev/docs/testing.md) for test ownership and broader verification. Shared UI tests currently use the plugin's DOM test infrastructure; their location does not make the implementation plugin-only.

## When shared UI needs a host operation

Read [ClientHost](../../../apps/pi-client/src/host/clientHost.ts), [UI capabilities](../../../apps/pi-client/src/shared/model/clientUiCapabilities.ts), and the [shared-client contract](../../../apps/pi-client/SPEC.md).

- Keep real VS Code APIs in its thin adapter. Desktop adapts the same finite interface; do not import a product runtime into the client or copy a shared component into Desktop.
- Decide whether this is a shared UI difference or a plugin-local integration. Do not turn plugin-only work into a Desktop feature requirement.
- For an actual presentation difference, use the existing capability declaration. A product's Host and browser entry consume the same constant. New required fields make both real hosts answer explicitly; `false` may mean inapplicable, deliberately omitted, or not implemented. Record a short reason beside it.
- Exercise each supported operation at its real execution boundary. File navigation/diagnostics are Host bindings; editor tabs are coordinator/dispatcher inputs. Function presence alone is not evidence of correct behavior.
- Test the affected UI entry with both supported and unsupported capabilities, including real tool/Markdown content when relevant. Synthetic capability tests and real product assembly tests answer different questions. Neither discovers every future missed gate.
- Keep dispatcher method checks, schema validation and session authorization. Presentation flags do not grant authority.

Do not add a flag to every common action merely for symmetry. Do not promise to detect arbitrary copied UI by finding a string in two bundles.

## Commands, settings and theme

- Local Composer commands enter through the product's `LocalComposerCommands`. Reuse common descriptors/behavior; register product-only commands in that product. Completion merging reserves only names the product handles, including intentionally hidden panel commands. Do not remove a Pi command merely because another product owns a same-named local command.
- FrostPi definitions/defaults come from `apps/vscode/package.json`; follow the [generation workflow](../../../.dev/docs/development.md#setting-definitions). Native VS Code settings have a different source; do not require `chat.*`, `editor.*` or `files/search.exclude` to exist in the FrostPi manifest. Desktop import and original-key storage follow its [settings contract](../../../apps/desktop/SPEC.md#settings-and-initial-import).
- Preserve the existing VS Code CSS language and scoped/global ownership in [AGENTS.md](../../../AGENTS.md) and the [UI spec](../../../.dev/docs/design/ui-spec.md). Check actual variable/fallback/theme behavior; do not add a blanket ban on `--vscode-*`.

## Finish at the appropriate boundary

Use focused checks while iterating. Finish shared boundary/assembly changes with `pnpm check`; run native smoke/E2E explicitly when their paths are affected. Source-only tests do not prove a newly bundled native dependency can start.

Interpret results using [Evidence boundaries](../../../.dev/docs/testing.md#evidence-boundaries): controlled GUI children, real Pi Runtime, Extension Host E2E and real Pi GUI are distinct evidence. Report an environment-blocked or timed-out run as unverified, not passed and not automatically a product defect. Packaging/release gates remain owned by [release.md](../../../.dev/docs/release.md).

Update the affected SPEC/workflow in the same change when its contract changes. Keep task progress and temporary evidence out of this reusable skill.
