# Pi Settings Loading

## Responsibility

`loadPiSettings()` is the Extension Host's shared, read-only view of the settings files used by the externally selected Pi process. It owns Pi agent-directory resolution, settings-file parsing, project-trust inference, and deep merging. It does not write settings or introduce FrostPi preferences that duplicate Pi settings.

The returned contract keeps source and effective views distinct:

- `global`: the parsed agent-directory `settings.json`, or an empty object when absent or invalid.
- `project`: the parsed `<cwd>/.pi/settings.json`, even when project settings are not trusted.
- `projectTrust`: whether the loader expects headless Pi to apply the project source, plus the decision source.
- `merged`: global settings deeply merged with project settings only when `projectTrust.trusted` is true.

Consumers that inspect configured possibilities, such as session discovery and model-scope display, may intentionally read the source views. Consumers that must follow active Pi behavior use `merged`.

## Paths and precedence

`PI_CODING_AGENT_DIR` selects the agent directory. `~` expands to the Extension Host user's home, relative values resolve against the session working directory, and the default is `~/.pi/agent`.

Project settings override global settings. Plain objects merge recursively; arrays and scalar values replace the global value. Missing, malformed, or non-object JSON contributes an empty object. Feature-specific selectors validate their own values; `showCacheMissNotices` is enabled only by the boolean value `true` and otherwise defaults to false.

## Project trust

When Pi finds a trust-requiring project resource—entries such as settings, extensions, skills, prompts, themes, or system-prompt files under `.pi`, or an inherited project `.agents/skills` directory—command-line `--approve`/`-a` or `--no-approve`/`-na` wins, with the last occurrence taking precedence. Otherwise the nearest boolean decision in `<agentDir>/trust.json` wins. With no stored decision, global `defaultProjectTrust: "always"` trusts the project; `"ask"`, `"never"`, absent, and invalid values do not trust it in headless RPC operation. No trust-requiring resource yields `not-required`.

An absent or malformed trust store contributes no saved decision; Pi itself may instead reject a malformed trust store during startup. Pi extensions can also answer Pi's `project_trust` hook during startup. That in-process result is not exposed by RPC and therefore cannot be observed by this file-based loader. Explicit launch overrides remain the only guaranteed way for FrostPi and an extension-overridden Pi trust decision to agree. These compatibility boundaries must remain visible rather than being hidden behind a second FrostPi preference.

## Boundaries

This module does not import or bundle `@earendil-works/pi-coding-agent`: FrostPi connects to a user-selected external executable that may be a different package version or a standalone binary. It contains no VS Code, Webview, session, or conversation policy.
