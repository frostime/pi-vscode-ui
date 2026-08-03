# FrostPi

A VS Code GUI adapter for your existing Pi setup.

FrostPi is designed for users who manage their own Pi configuration, extensions, models, and credentials, but want a graphical interface inside VS Code.

It runs your configured Pi through its native RPC mode. Pi remains responsible for execution, configuration, extensions, and session data; FrostPi provides the GUI and VS Code integration.

<p align="center">
  <img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/preview.png" alt="FrostPi conversation view in VS Code" width="430">
</p>

## Highlights

- Fork selected context into a separate Pi and FrostPi session when the continuation should remain independent.
- Create, resume, switch, rename, and concurrently run independent Pi sessions.
- Navigate Pi's session tree visually: revise earlier prompts with **Branch here**, switch existing paths, and optionally preserve context with branch summaries.
- Worktree support: if the vscode workspace has git worktree, you can add new/resume session from it.
- Stream ordered reasoning, tool activity, command output, errors, and final responses.
- Paste PNG, JPEG, or WebP images directly into prompts.
- Use `/` completion for Pi extension commands, prompt templates, skills, and FrostPi-local actions.
- Use `@Selection`, `@CurrentFile`, and workspace paths as explicit prompt references.
- Switch provider/model and select only thinking levels supported by the active model's Pi metadata.
- Review command output and tool details; open files and Git-base diffs in native VS Code editors.
- Inspect context, token categories, tool/message counts, and estimated session cost.
- Configure inherited, VS Code, custom, or direct proxy modes for Pi subprocesses.

## Screenshots

<table>
  <tr>
    <td width="50%"><strong>Independent sessions</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/multi-session.png" alt="FrostPi session switcher" width="100%"></td>
    <td width="50%"><strong>Model controls</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/model-picker.png" alt="FrostPi model picker" width="100%"></td>
  </tr>
  <tr>
    <td><strong>Workspace-aware prompting</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/at-file.png" alt="FrostPi workspace file mention completion" width="100%"></td>
    <td><strong>Slash commands</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/slash-command.png" alt="FrostPi slash command completion" width="100%"></td>
  </tr>
  <tr>
    <td><strong>Compaction for long sessions</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/compact.png" alt="FrostPi compaction record" width="100%"></td>
    <td><strong>Context and cost detail</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/context-usage.png" alt="FrostPi context usage details" width="100%"></td>
  </tr>
  <tr>
    <td><strong>Native Pi Session Tree</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/tree-button.png" alt="FrostPi Pi session tree branch controls" width="100%"></td>
    <td><strong>Git Worktree Sessions</strong><br><img src="https://raw.githubusercontent.com/frostime/frostpi/main/docs/assets/screenshots/support-worktree.png" alt="FrostPi Git worktree session picker" width="100%"></td>
  </tr>
</table>

## Pi Session Tree and Fork

FrostPi exposes Pi's session-tree workflow as graphical conversation controls:

- **Branch here** restores an earlier user prompt and continues from it as another path in the same Pi session and session file.
- **Switch branch** uses a native VS Code picker to move between existing paths, with message count, last update, ending context, and optional branch summaries.
- **Fork** creates a separate Pi session and FrostPi session instead of another path in the current tree.

Pi remains authoritative for tree navigation and context reconstruction. FrostPi provides the GUI compatibility layer and keeps Tree navigation distinct from Fork's independent-session lifecycle.

## Requirements and Setup

1. Install and configure Pi in the same local or remote environment where VS Code runs workspace extensions.
2. Open a trusted file-system workspace.
3. Open **FrostPi** from the Activity Bar. The view may be dragged to VS Code's Secondary Sidebar.
4. Start a new session, resume an existing Pi session, or paste a prompt into the composer.
5. If `pi` is not on `PATH`, run **FrostPi: Configure Pi Executable**.

The executable may be the `pi` command, an absolute native executable, or Pi's compiled `cli.js` path. Remote SSH, WSL, and Dev Container workspaces run Pi in the remote Extension Host.

For best workspace and session discovery, install `fd` and `rg` on the Extension Host's `PATH`. `fd` is required for `@` workspace file completion; `rg` accelerates Resume session discovery and FrostPi falls back to bounded metadata scanning when it is unavailable.

## Important Behavior

Pi edits the workspace immediately, as it does in RPC mode. FrostPi's Diff action compares the current file with its Git `HEAD` version; it is review, not pre-apply authorization.

Multiple sessions can modify the same workspace concurrently. FrostPi isolates their processes and UI state but does not serialize or reconcile conflicting changes.

Proxy configuration is resolved when a Pi process starts. Changing proxy settings does not update an already-running session. Restart the affected session to apply the new environment. Proxy environment variables are also inherited by commands launched by Pi.

FrostPi injects `PI_INSIDE_FROSTPI=1` and `PI_INSIDE_FROSTPI_VERSION=<extension version>` into every Pi child process. Pi extensions can read these to detect that they are running under FrostPi and which version launched them.

## Settings

- `frostpi.pi.executable`
- `frostpi.pi.arguments`
- `frostpi.session.startOnOpen`
- `frostpi.composer.streamingBehavior`
- `frostpi.composer.fileMentions.maxFiles`
- `frostpi.composer.fileMentions.respectSearchExclude`
- `frostpi.attachments.maxImageBytes`
- `frostpi.network.proxy.mode`
- `frostpi.network.proxy.endpoint`
- `frostpi.network.proxy.noProxy`
- `frostpi.diagnostics.level`

FrostPi also follows VS Code's Chat typography settings as soon as they change:

- `chat.fontFamily` controls rendered message text.
- `chat.fontSize` controls rendered message and code-block size.
- `chat.editor.fontFamily` controls the composer and code-block font.
- `chat.editor.fontSize` controls the composer size.

When a Chat font remains `default`, FrostPi falls back to VS Code's normal interface or editor font.

Use **FrostPi: Configure Network Proxy** or the session menu to choose User/Workspace scope and configure the active mode. Proxy usernames and passwords are stored in VS Code SecretStorage rather than in `settings.json`. Running sessions show `restart required` until explicitly restarted.

## Privacy

FrostPi contains no telemetry or remote service of its own. Prompts and images are sent to the locally launched Pi process. See [`PRIVACY.md`](PRIVACY.md) in the extension package for details.

## Repository

For comparisons, architecture, development instructions, and protocol documentation, see the [FrostPi repository](https://github.com/frostime/frostpi).

## License

AGPL-3.0-only. FrostPi is an independent client and is not an official Pi distribution.
