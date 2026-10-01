<p align="center">
  <img src="assets/branding/hero-icon.jpg" alt="FrostPi" width="140">
</p>

<h1 align="center">Pi VS Code UI — FrostPi</h1>

<p align="center">
  <strong>A visual VS Code UI for Pi Coding Agent, built around the Pi you already use.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

FrostPi brings your existing Pi Coding Agent workflow into VS Code without replacing your configuration, extensions, models, or sessions.

<p align="center">
  <img src="assets/screenshots/preview.png" alt="FrostPi conversation view" width="430">
</p>

This extension is published both on **[VsCode marketplace](https://marketplace.visualstudio.com/items?itemName=frostime.frostpi)** and **[Open VSX](https://open-vsx.org/extension/frostime/frostpi)**.

You can also download `*.vsix` file in Github release and install mannually, if network is constrainet on your machine.

## Why FrostPi

If you already use Pi and have built your own workflow around it, getting a GUI shouldn't mean adopting another one.

FrostPi uses **your Pi, your configuration, your extensions, your models, and your sessions**. It does not maintain a parallel Pi setup, inject a system prompt, or try to manage your workflow for you.

**FrostPi handles the GUI. Pi stays in charge.**

## Highlights

**The Pi experience, not just the chat.**

FrostPi aims to keep Pi's functional workflows available from the GUI: extension commands, prompt templates, skills, model selection, thinking controls, Resume, `/compact`, tree summaries, custom extension messages, and more.

Conversation rendering supports ordered reasoning, tool activity, command output, errors, images, rich Markdown including Mermaid, compaction records, branch summaries, and extension-defined custom messages.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="assets/screenshots/model-picker.png" alt="Model picker" width="440">
      <br>
      <sub>Model and thinking controls</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/screenshots/at-file.png" alt="Workspace references" width="440">
      <br>
      <sub>Workspace-aware prompting</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="assets/screenshots/slash-command.png" alt="Slash commands" width="440">
      <br>
      <sub>Extension commands, prompts, and skills</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/screenshots/compact.png" alt="Compaction" width="440">
      <br>
      <sub>Native compaction messages</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="assets/screenshots/steer+queue.png" alt="Steer and queue controls" width="440">
      <br>
      <sub>Steer and queue controls</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/screenshots/context-usage.png" alt="Context and cost detail" width="280">
      <br>
      <sub>Context, token usage, and estimated session cost</sub>
    </td>
  </tr>
</table>

**Pi's session tree, directly in the GUI.**

Pi sessions are trees, not just linear chat histories. FrostPi exposes Pi's native tree workflow as graphical controls: branch from an earlier prompt, switch between existing paths, and optionally preserve context with branch summaries.

<p align="center">
  <img src="assets/screenshots/tree-button.png" alt="Pi session tree in FrostPi" width="900">
</p>

**Fork when you actually want another session.**

Tree navigation stays inside the current Pi session and session file. Fork is intentionally different: it creates a separate Pi session and FrostPi session, so the continuation can run and persist independently.

**Run Pi in parallel — including across Git worktrees.**

Create, resume, switch, rename, and concurrently run independent Pi sessions. If the workspace belongs to a repository with Git worktrees, FrostPi can also start or resume sessions from them.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="assets/screenshots/multi-session.png" alt="Multiple Pi sessions" width="440">
      <br>
      <sub>Independent concurrent sessions</sub>
    </td>
    <td width="50%" align="center">
      <img src="assets/screenshots/support-worktree.png" alt="Git worktree sessions" width="440">
      <br>
      <sub>Sessions across Git worktrees</sub>
    </td>
  </tr>
</table>



**Conversation rendered, not flattened.**

Agent output stays readable instead of collapsing into plain text:

- Full **Markdown** with sanitization and syntax-highlighted code fences.
- **Mermaid** diagrams — incomplete fences remain plain source while streaming; complete ones render as diagrams.
- **Math** via KaTeX — inline `$...$` and block `$$...$$` display formulas.
- **Embedded images** — PNG, JPEG, WebP, GIF, and SVG with captions, the shared Lightbox, lazy local loading, and click-to-load for remote HTTPS images.
- **Diffs** — `diff`/`patch` fences and tool diffs use VS Code diff colors, down to word-level intra-line additions and deletions.

<p align="center">
  <img src="assets/screenshots/RenderMD.webp" alt="Rendered Markdown in FrostPi" width="640">
  <br>
  <sub>One assistant message, rendered live</sub>
</p>

## Getting Started

### Requirements

- VS Code 1.99 or newer.
- A trusted file-system workspace.
- Pi installed and configured in the same environment as the VS Code Extension Host.
- Pi available as `pi` on `PATH`, or configured through `frostpi.pi.executable`.
- `fd` and `rg` are recommended on the Extension Host's `PATH`.

Remote SSH, WSL, and Dev Container workspaces run FrostPi and Pi in the remote workspace Extension Host. FrostPi does not bridge a local Pi process into a remote file system.

### Setup

1. Install FrostPi in VS Code.
2. Open a trusted workspace.
3. Open FrostPi from the Activity Bar. The view can be moved to the Secondary Sidebar.
4. Start a new session, resume an existing Pi session, or paste a prompt into the composer.
5. If Pi is not on `PATH`, run **FrostPi: Configure Pi Executable**.

The executable may be the `pi` command, an absolute native executable, or Pi's compiled `cli.js` path.

## Reference

### Prompt and workspace context

Paste PNG, JPEG, or WebP images directly into the composer.

Use `/` completion for Pi extension commands, prompt templates, skills, and FrostPi-local actions.

For rendering details such as streaming Mermaid behavior, image loading rules, and diff emphasis, see [`apps/vscode/src/webview/features/conversation/markdown/markdown.SPEC.md`](apps/vscode/src/webview/features/conversation/markdown/markdown.SPEC.md).

Use `@Selection`, `@CurrentFile`, or `@path/to/file` for workspace references. FrostPi inserts path and line information into the prompt; Pi remains responsible for deciding whether and how to read the file.

### Models and sessions

Run multiple independent Pi sessions, switch providers and models, resume existing sessions, and select only the thinking levels exposed by the active model's Pi metadata.

Session state remains visible while other sessions continue working in the background.

### Pi Session Tree and Fork

FrostPi provides a graphical interface for Pi's session-tree workflow:

- **Branch here** navigates to an earlier user prompt, restores it in the Composer, and lets you continue as another path in the same Pi session and session file.
- **Switch branch** opens a searchable native VS Code picker for existing paths. Path rows expose message count, last update, and ending context. Leaving the current path may use no summary, Pi's default branch summary, or custom summary-focus instructions.
- **Fork** creates a separate Pi session and FrostPi session. Use it when the continuation should run and persist independently instead of becoming another path in the current session tree.

Pi remains authoritative for the active tree leaf and reconstructed conversation context. FrostPi supplies the GUI compatibility layer.

For GUI tree operations that Pi RPC does not expose directly, FrostPi loads a small process-local adapter through Pi's extension mechanism. The adapter exists to bridge the GUI operation; it does not replace Pi's tree implementation.

### Question tool

FrostPi includes an optional `question` tool for answering agent questions directly inside the Webview. It is **disabled by default**.

Set:

```text
frostpi.questionTool.enabled
```

to enable it for newly started Pi session processes. Restart an already-running session after changing the setting.

When enabled, question requests open in a bounded, collapsible panel below the conversation. Every question requires an explicit answer and **Submit**, including single-question requests.

The tool is deliberately opt-in because, unlike the tree adapter, it registers a model-visible Pi tool.

Pi loads project and global extensions before FrostPi's explicitly injected bundled extension. If an existing extension has already registered `question`, that registration keeps priority.

Every Pi child process launched by FrostPi receives:

```text
PI_INSIDE_FROSTPI=1
PI_INSIDE_FROSTPI_VERSION=<extension version>
```

Third-party Pi extensions can read these variables to detect that they are running under FrostPi and which FrostPi version launched them. For example, a third-party question extension can conditionally skip its own registration when the user prefers FrostPi's Webview question tool.

`PI_INSIDE_FROSTPI` identifies FrostPi regardless of whether the bundled question tool is enabled. Extensions therefore **should not unconditionally disable themselves just because this variable is present**.

### Network and diagnostics

FrostPi supports inherited, VS Code, custom, and direct proxy modes for Pi subprocesses.

Custom proxy mode accepts:

- `host:port`
- `http://...` or `https://...`
- `socks5://...`

Proxy usernames and passwords are stored in VS Code SecretStorage instead of `settings.json`.

Proxy configuration is resolved when a Pi process starts. Changing proxy settings does not update an already-running session; restart the affected session to apply the new environment. Proxy environment variables are also inherited by commands launched by Pi.

FrostPi also provides context metrics, diagnostics export, strict LF-delimited JSONL transport, and schema-checked Host-Webview messages.

### Settings

Common settings include:

- `frostpi.pi.executable`
- `frostpi.pi.runtimeCompatibility` — choose the limited Pi or Oh My Pi compatibility contract; this does not enable all runtime-specific OMP features.
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

Use **FrostPi: Configure Network Proxy** or the session menu to choose User/Workspace scope and configure the active proxy mode. Running sessions show `restart required` until explicitly restarted.

### Typography

When supported by the installed VS Code version, FrostPi follows these VS Code Chat settings as soon as they change:

- `chat.fontFamily` — rendered Markdown message text.
- `chat.fontSize` — rendered message and code-block size.
- `chat.editor.fontFamily` — composer and Markdown code-block font.
- `chat.editor.fontSize` — composer size.

When a Chat font remains `default`, FrostPi falls back to VS Code's normal interface or editor font.

### Limited `oh-my-pi` compatibility

FrostPi provides limited compatibility with `oh-my-pi`. You can switch to omp as follows:

Set `FrostPi: Pi Runtime Compatibility` to `oh-my-pi` in the VS Code settings, or configure it in `settings.json`:

```json
{
  "frostpi.pi.runtimeCompatibility": "oh-my-pi"
}
```

Effects after selecting it:

- Uses `omp` instead of `pi` by default.

  If `omp` is not on `PATH`, configure `frostpi.pi.executable` with the path to its executable.
- Reads session history from `.omp/sessions` instead of `.pi` by default.

  If you use a custom session directory or model scope, pass `--session-dir` through `frostpi.pi.arguments`.

**Limitations**:

We only provide a minimal compatibility layer. It only guarantees that FrostPi can launch `omp --mode rpc` under OMP's basic compatibility contract, covering basic conversation, tool calls, model switching, and discovering and resuming sessions in OMP's default or explicitly configured session directories.

However, you may not get the complete omp experience in FrostPi — because omp's RPC format is incompatible in places, you may hit odd bugs in practice.

### Development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm package:vsix
pnpm verify:vsix
pnpm package:zip
```

The workspace contains:

- `packages/pi-rpc` — Pi subprocess transport and typed RPC API.
- `apps/vscode` — Extension Host, stable Host-Webview contracts, and Svelte UI.
- `docs` — architecture, protocol, UI, testing, privacy, and release documentation.

Start with [`.dev/docs/index.md`](.dev/docs/index.md). Behavioral compatibility contracts live next to their modules as `*.SPEC.md` or `SPEC.md`.

### Privacy and License

FrostPi contains no telemetry or remote service of its own. Prompts and images are passed to the locally launched Pi process.

See [`PRIVACY.md`](PRIVACY.md) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for details.

FrostPi is licensed under **AGPL-3.0-only**.

FrostPi is an independent client and is not an official Pi distribution.

## FAQ

### Why does FrostPi provide a `question` tool if it is non-intrusive?

We try not to touch the internals of the user's Pi runtime. However:

- Question/Ask tools are important for agentic coding.
- Common Question/Ask tools depend on a complex TUI and cannot work properly in a GUI.

For that reason, FrostPi provides this as one of the few optional exceptions. If you enable it, we recommend disabling other local question tools to avoid conflicts.

### What impact does FrostPi have on the Pi runtime?

The impact is limited, apart from the optional `question` tool, which is disabled by default.

If you configure a proxy, FrostPi sets the proxy environment variables when the process starts.

FrostPi also injects a `session-tree-adapter` extension to provide Pi's tree functionality in the GUI. This extension is process-local: it does not write to Pi's home directory or interfere with the Agent's runtime context.

### Why are `fd` and `rg` recommended?

They are not mandatory, and not having them does not prevent FrostPi from working.

FrostPi's `@` workspace completion uses `fd` internally, while session resume uses `rg` to accelerate session-file parsing. Installing both improves the experience.

### Will FrostPi provide Pi extension tools integrated with VS Code?

Not currently. We may integrate tools that read VS Code workspace state in the future. Any such extension features will be introduced cautiously and disabled by default.

### Why does the Write tool show only `+<lines>` instead of file additions and removals like Edit?

See GitHub issue [#6](https://github.com/frostime/pi-vscode-ui/issues/6).

**TL;DR:** Pi's built-in Write tool returns only the changed result, not a diff, so FrostPi cannot obtain the actual file changes.

However, FrostPi treats any tool details that include a `diff` as an Edit-like tool. You can implement an extension yourself. For example, you can send the following prompt to your Agent:

> Implement an extension in Pi's home directory that overrides Pi's built-in Write tool and returns a `diff: string` field in its details, similar to the Edit tool. It is acceptable to construct the value by concatenating `-oldcontent` and `+newcontent`; only the changed line counts need to be accurate, not the hunk positions.

FrostPi will not implement this extension for you. We try to avoid conflicting with user extensions and will not silently change Pi's execution behavior.
