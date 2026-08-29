<p align="center">
  <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/branding/hero-icon.jpg" alt="FrostPi" width="140">
</p>

<h1 align="center">Pi VS Code UI — FrostPi</h1>

<p align="center">
  <strong>A visual VS Code UI for Pi Coding Agent, built around the Pi you already use.</strong>
</p>

<p align="center">
  <a href="https://github.com/frostime/pi-vscode-ui/blob/main/README.md">English</a> ·
  <a href="https://github.com/frostime/pi-vscode-ui/blob/main/README.zh-CN.md">简体中文</a>
</p>

FrostPi brings your existing Pi Coding Agent workflow into VS Code without replacing your configuration, extensions, models, or sessions.

<p align="center">
  <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/preview.png" alt="FrostPi conversation view" width="430">
</p>

## Why FrostPi

If you already use Pi and have built your own workflow around it, getting a GUI shouldn't mean adopting another one.

FrostPi uses **your Pi, your configuration, your extensions, your models, and your sessions**. It does not maintain a parallel Pi setup, inject a system prompt, or try to manage your workflow for you.

**FrostPi handles the GUI. Pi stays in charge.**

## Highlights

**The Pi experience, not just the chat.**

FrostPi keeps Pi's functional workflows available from the GUI:

- Stream ordered reasoning, tool activity, command output, errors, and final responses.
- Paste PNG, JPEG, or WebP images directly into prompts.
- Use `/` completion for Pi extension commands, prompt templates, skills, and FrostPi-local actions.
- Use `@Selection`, `@CurrentFile`, and workspace paths as explicit prompt references.
- Switch provider/model and select only thinking levels supported by the active model's Pi metadata.
- Resume sessions and use Pi's native `/compact` and session-summary behavior.
- Render rich Markdown including Mermaid, compaction records, branch summaries, and Pi extension custom messages.
- Review command output and tool details; open files and Git-base diffs in native VS Code editors.
- Inspect context, token categories, tool/message counts, and estimated session cost.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/model-picker.png" alt="Model picker" width="440">
      <br>
      <sub>Model and thinking controls</sub>
    </td>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/at-file.png" alt="Workspace references" width="440">
      <br>
      <sub>Workspace-aware prompting</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/slash-command.png" alt="Slash commands" width="440">
      <br>
      <sub>Extension commands, prompts, and skills</sub>
    </td>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/compact.png" alt="Compaction" width="440">
      <br>
      <sub>Native compaction messages</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/steer+queue.png" alt="Steer and queue controls" width="440">
      <br>
      <sub>Steer and queue controls</sub>
    </td>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/context-usage.png" alt="Context and cost detail" width="280">
      <br>
      <sub>Context, token usage, and estimated session cost</sub>
    </td>
  </tr>
</table>

**Pi's session tree, directly in the GUI.**

Branch from an earlier prompt, move between existing paths, and optionally preserve context with Pi's branch summaries — all inside the current Pi session.

<p align="center">
  <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/tree-button.png" alt="Pi session tree in FrostPi" width="900">
</p>

**Fork into an independent session.**

Fork selected context when you want the continuation to have its own Pi process, lifecycle, and session history instead of becoming another path in the current tree.

**Multiple sessions and Git worktrees.**

Create, resume, switch, rename, and concurrently run independent Pi sessions. If the current repository has Git worktrees, new and resumed sessions can run from them as well.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/multi-session.png" alt="Multiple Pi sessions" width="440">
      <br>
      <sub>Independent concurrent sessions</sub>
    </td>
    <td width="50%" align="center">
      <img src="https://raw.githubusercontent.com/frostime/pi-vscode-ui/main/assets/screenshots/support-worktree.png" alt="Git worktree sessions" width="440">
      <br>
      <sub>Sessions across Git worktrees</sub>
    </td>
  </tr>
</table>



## Getting Started

1. Install and configure Pi in the same local or remote environment where VS Code runs workspace extensions.
2. Open a trusted file-system workspace.
3. Open FrostPi from the Activity Bar. The view may be dragged to VS Code's Secondary Sidebar.
4. Start a new session, resume an existing Pi session, or paste a prompt into the composer.
5. If `pi` is not on `PATH`, run **FrostPi: Configure Pi Executable**.

The executable may be the `pi` command, an absolute native executable, or Pi's compiled `cli.js` path.

Remote SSH, WSL, and Dev Container workspaces run Pi in the remote Extension Host.

For best workspace and session discovery, install `fd` and `rg` on the Extension Host's `PATH`. `fd` is required for `@` workspace file completion; `rg` accelerates Resume session discovery, with bounded metadata scanning used as a fallback when it is unavailable.

## Reference

### Pi Session Tree and Fork

FrostPi exposes Pi's session-tree workflow as graphical conversation controls:

- **Branch here** restores an earlier user prompt and continues from it as another path in the same Pi session and session file.
- **Switch branch** uses a native VS Code picker to move between existing paths, with message count, last update, ending context, and optional branch summaries.
- **Fork** creates a separate Pi session and FrostPi session instead of another path in the current tree.

Pi remains authoritative for tree navigation and context reconstruction. FrostPi provides the GUI compatibility layer and keeps Tree navigation distinct from Fork's independent-session lifecycle.

For tree operations that Pi RPC cannot expose directly, FrostPi loads a small process-local adapter through Pi's extension mechanism.

### Question tool

FrostPi includes an optional bundled `question` tool for answering Pi question requests directly inside the Webview. It is **disabled by default**.

Enable it with:

```text
frostpi.questionTool.enabled
```

The bundled extension is injected when a Pi session process starts, so restart running sessions after changing the setting.

Question requests appear in a bounded, collapsible panel below the conversation. Every question requires an explicit answer and **Submit**, including single-question requests.

Pi loads project and global extensions before FrostPi's explicit bundled extension. If another extension has already registered `question`, that registration keeps priority.

FrostPi injects the following environment variables into **every** Pi child process:

```text
PI_INSIDE_FROSTPI=1
PI_INSIDE_FROSTPI_VERSION=<extension version>
```

Pi extensions can use them to detect that they are running under FrostPi and which FrostPi version launched them.

A third-party question extension can, for example, conditionally skip registration when the user wants FrostPi's Webview question tool instead. However, `PI_INSIDE_FROSTPI` is present regardless of whether `frostpi.questionTool.enabled` is on, so extensions should **not** use the variable as an unconditional signal to disable themselves.

### Network and diagnostics

FrostPi supports inherited, VS Code, custom, and direct proxy modes for Pi subprocesses.

Custom mode accepts:

- `host:port`
- `http://...` or `https://...`
- `socks5://...`

Use **FrostPi: Configure Network Proxy** or the session menu to choose User/Workspace scope and configure the active mode.

Proxy usernames and passwords are stored in VS Code SecretStorage rather than in `settings.json`. Running sessions show `restart required` until explicitly restarted.

FrostPi also provides context metrics, diagnostics export, strict LF-delimited JSONL transport, and schema-checked Host-Webview messages.

### Settings

- `frostpi.pi.executable`
- `frostpi.pi.arguments`
- `frostpi.session.startOnOpen`
- `frostpi.composer.streamingBehavior`
- `frostpi.composer.fileMentions.respectSearchExclude`
- `frostpi.composer.fileMentions.respectIgnoreFiles`
- `frostpi.composer.fileMentions.followSymlinks`
- `frostpi.attachments.maxImageBytes`
- `frostpi.questionTool.enabled`
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

### Privacy, Repository, and License

FrostPi contains no telemetry or remote service of its own. Prompts and images are sent to the locally launched Pi process.

See [`PRIVACY.md`](PRIVACY.md) in the extension package for details.

For comparisons, architecture, development instructions, and protocol documentation, see the [FrostPi repository](https://github.com/frostime/pi-vscode-ui).

FrostPi is licensed under **AGPL-3.0-only**.

FrostPi is an independent client and is not an official Pi distribution.
