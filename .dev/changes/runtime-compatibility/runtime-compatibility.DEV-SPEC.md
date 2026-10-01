---
title: Runtime compatibility profiles for Pi-compatible agents
description: Add a minimal compatibility profile for Oh My Pi without claiming support for its runtime-specific features.
scope:
  - /apps/vscode/src/extension/configuration/**
  - /apps/vscode/src/extension/sessions/**
  - /apps/vscode/src/extension/models/**
updated: 2026-10-02
---

# Runtime compatibility profiles for Pi-compatible agents

## Problem Statement

Issue #4 reports that FrostPi can already launch Oh My Pi (`omp`) when the user changes the configured executable, but the existing-session picker does not find Oh My Pi sessions by default.

The current integration treats every executable as the original Pi runtime. Its default session discovery and Pi-settings interpretation therefore point at Pi's paths and semantics even when the selected executable is Oh My Pi. This makes the basic RPC integration appear usable while leaving session discovery and a few FrostPi-side projections inconsistent.

Success means that a user can select a minimal Oh My Pi compatibility profile and use FrostPi for the compatibility surface FrostPi already depends on: launch, RPC interaction, session discovery, and session resume. Success does **not** mean that FrostPi exposes or mirrors Oh My Pi's runtime-specific features.

## Approach

Add one explicit compatibility setting:

```text
frostpi.pi.runtimeCompatibility
```

The initial values are:

- `pi` — existing behavior and Pi settings semantics;
- `oh-my-pi` — the minimal compatibility behavior required to use `omp` through FrostPi.

The setting describes the compatibility contract FrostPi applies; it is not a claim of complete support for the selected runtime. It is resource-scoped so different workspaces can select different compatibility profiles. An explicit executable remains an override of the profile's default executable.

The first Oh My Pi profile remains deliberately small. It supplies the runtime-specific executable and default session root, while reusing the existing RPC transport, session JSONL scanner, session metadata handling, and resume launch path. OMP-specific configuration and features are deferred instead of being guessed or partially mirrored.

The implementation uses a small, centralized compatibility policy rather than a full adapter/plugin system. The policy owns only runtime facts needed by FrostPi (profile identity, executable fallback, default session root, and whether Pi settings projections apply); the existing session catalog, model-scope resolver, and session runtime retain ownership of their respective behavior.

A broad "scan every known runtime directory" fallback and a generic runtime plugin system are rejected for this change. They would mix sessions from different runtimes or create extension machinery before a second independent compatibility contract requires it.

## Behavior Contract

### Profile selection

- An absent setting, and the `pi` value, preserve the current Pi-compatible behavior.
- `oh-my-pi` selects the OMP-compatible defaults.
- If `frostpi.pi.executable` is explicitly configured, it takes precedence over the profile's default executable. The profile does not silently inspect or rewrite the configured executable.
- The setting description must state that the profile covers only FrostPi's declared compatibility surface, not all runtime-specific features.

### Process launch and resume

| Compatibility | Default executable | Default session root |
| --- | --- | --- |
| `pi` | `pi` and current existing resolution behavior | `~/.pi/agent/sessions` |
| `oh-my-pi` | `omp` on Unix-like systems; the official Windows binary `omp.exe` on Windows | `~/.omp/agent/sessions` |

Both profiles continue to use the existing RPC launch contract (`--mode rpc`) and the existing resume argument (`--session <absolute-jsonl-path>`). No separate OMP RPC client or session-file parser is introduced.

A session directory explicitly supplied in `frostpi.pi.arguments` with `--session-dir` remains valid in either profile. It is both passed to the child runtime and used by FrostPi's session discovery, as it is today. This explicit CLI input is not the same thing as importing Pi's `.pi/settings.json` semantics.

When `oh-my-pi` is selected, Pi's default and project-configured session roots are not included merely because they exist. In particular, FrostPi does not discover sessions through `<workspace>/.pi/settings.json` or Pi's default `~/.pi/agent/sessions` in this profile. The OMP default root is used unless an explicit `--session-dir` argument supplies another root. An explicit argument remains valid even when it points at a user-chosen path outside the OMP default layout.

### Pi settings and OMP settings

- In `pi` compatibility, the existing Pi settings behavior remains available, including Pi `sessionDir`, `enabledModels`, and `showCacheMissNotices` consumers.
- In `oh-my-pi` compatibility, FrostPi does not read Pi's global `settings.json`, `<workspace>/.pi/settings.json`, Pi trust metadata, or Pi-specific settings fields for its own projections.
- The first OMP profile does not parse or map OMP's `config.yml`/legacy settings model. OMP settings integration is explicitly deferred until a concrete FrostPi-facing OMP setting contract is defined.
- OMP itself remains authoritative for its own configuration, approval behavior, model policy, extensions, and runtime-specific features.

### Model selection projection

- An explicit `--models` argument in `frostpi.pi.arguments` remains supported in both profiles. FrostPi continues to pass it to the child runtime and use it to calculate the `Scoped` model-picker view.
- In `pi` compatibility, Pi `enabledModels` settings continue to contribute to the `Scoped` view as they do now.
- In `oh-my-pi` compatibility, Pi `enabledModels` is not read. Without an explicit `--models`, FrostPi shows the complete model catalogue returned by OMP (`All`); this does not prevent the user from selecting a model or prevent OMP from applying its own model policy.
- `Scoped` and `All` remain presentation choices. Actual model acceptance remains the responsibility of the child runtime through the existing `setModel` RPC command.

### Turn settle event projection

- Pi reports the end of a stretch of work as `agent_settled`; Oh My Pi reports the same boundary as `session_settled`.
- Oh My Pi event-vocabulary differences live in one named adapter (`PI_OMP_ADAPTER`) in the session runtime, not as inline branches at the consumers. It projects the Oh My Pi settle event onto Pi's `agent_settled` at the runtime's single event ingress; every other event passes through unchanged.
- In `pi` compatibility the adapter returns the event untouched, so Pi behavior is unchanged.
- The Composer returns to its idle state only through that settle signal; an Oh My Pi turn that ends without it would leave the stop button active and skip the post-settle refresh.

### Explicit non-goals

This change does not promise:

- Oh My Pi's TUI, Agent Hub, DAP, memory, collaboration, or other OMP-specific features in FrostPi;
- an OMP `config.yml` reader or a mapping of OMP settings into FrostPi settings;
- mixed Pi/OMP session lists or automatic runtime identification per session;
- support for OMP profiles, XDG-specific storage variants, or arbitrary runtime-specific session layouts beyond explicit user configuration;
- a generalized third-party runtime plugin system;
- protocol or session-format conversion for a future incompatible major version.

## Implementation Decisions

- The setting is named `frostpi.pi.runtimeCompatibility`, not `frostpi.pi.runtime`, to communicate that FrostPi implements a bounded compatibility contract rather than complete runtime support.
- Compatibility selection owns runtime defaults that FrostPi must know: executable fallback and default session discovery root.
- `pi.executable` and explicit `--session-dir`/`--models` arguments remain user overrides and are not rewritten by compatibility selection.
- The existing RPC transport and compatibility-tolerant JSONL session scanner remain shared by both profiles because OMP's minimum supported surface is Pi-compatible.
- Oh My Pi event-vocabulary differences live in one named adapter in the session runtime; it projects the settle event at the runtime's single event ingress, so every downstream consumer keeps one Pi-shaped settle signal.
- Pi settings loading is selected by compatibility profile at its consumers, rather than treating OMP's configuration as if it were Pi's JSON settings. OMP settings support is a separate future decision.
- A missing or incompatible resumed session continues to fail visibly; FrostPi does not create a replacement empty session.
- The compatibility policy is a small pure configuration-level module, not a runtime adapter registry or plugin mechanism. Consumers receive the selected profile/policy through their existing configuration or function boundaries.
- `loadPiSettings` remains the Pi settings loader. OMP support is not added to it; Pi-settings consumers explicitly skip it in `oh-my-pi` mode.
- The `SessionCatalog` retains responsibility for candidate-root assembly and the existing scanner retains responsibility for recursive JSONL discovery. The model resolver retains responsibility for `Scoped` projection, and `SessionRuntime` retains responsibility for launch-time projection settings.
- `fd`/`rg` managed-bin lookup is not expanded to OMP-specific directories in this change; existing PATH fallback remains unchanged.
- Persisted FrostPi session records do not gain a runtime identity in this change. A session restored after the user changes the workspace compatibility setting uses the current profile and fails visibly if the selected runtime cannot resume it.

## Acceptance Criteria

- The configuration schema exposes `frostpi.pi.runtimeCompatibility` with `pi` and `oh-my-pi` values, a default preserving current Pi behavior, and a description that states the compatibility boundary.
- With the default/`pi` profile, existing Pi session discovery, Pi settings projections, and model-picker behavior remain unchanged.
- With `oh-my-pi` selected and no explicit executable, FrostPi launches the platform-appropriate OMP command with `--mode rpc` and discovers sessions below the OMP default session root.
- With an explicit executable, FrostPi launches that executable while retaining the selected compatibility profile's other defaults.
- In `oh-my-pi` mode, sessions found only through Pi's default root or `.pi/settings.json` are not listed; sessions found through an explicit `--session-dir` are listed, including when that path is user-selected outside the default OMP root.
- In `oh-my-pi` mode, `.pi/settings.json` and Pi global settings do not affect `sessionDir`, `enabledModels`, or cache-miss notice configuration.
- An explicit `--models` argument produces the existing `Scoped`/`All` model-picker behavior in `oh-my-pi` mode; without it, the picker fails open to `All` and model switching still uses the existing RPC path.
- Selecting a discovered OMP session starts the child with its absolute JSONL path and does not require a new resume implementation.
- Unit tests cover profile defaults, explicit executable/argument precedence, Pi-versus-OMP session-root isolation, Pi-settings exclusion in OMP mode, and explicit `--models`/`--session-dir` behavior.
- In `oh-my-pi` mode, Oh My Pi's settle event returns the session to `ready`, completes the running turn, and runs the post-settle refresh; unit tests cover that projection.
- Tests verify that existing Pi behavior remains unchanged when the setting is absent or set to `pi`.
- `pnpm check` and the focused VS Code unit tests pass after implementation.

## Terminology

- **Runtime compatibility profile**: FrostPi's bounded set of assumptions about an external agent executable's launch arguments, session storage, and settings projections. It does not mean that FrostPi supports every feature of that executable.
- **Pi settings**: The JSON settings sources currently understood by FrostPi: the user agent `settings.json` and the workspace `.pi/settings.json`.
- **OMP settings**: Oh My Pi's own configuration model, canonically stored in `config.yml` with legacy JSON compatibility. This change deliberately does not map it into FrostPi.
