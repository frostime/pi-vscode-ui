---
title: FrostPi Question Tool Handover
created: 2026-07-25T03:15:51+08:00
updated: 2026-07-25T03:45:00+08:00
---

# Current Status

Branch: `wip/frostpi-question-tool`.

The optional FrostPi-bundled Pi `question` tool is implemented, tested, documented, built, and present in the verified VSIX. Automated work is complete. The remaining validation is a manual VS Code Webview check, especially Remote SSH, 280 px width, and light/dark/high-contrast themes.

Committed checkpoints:

- `25053e9 📝 docs(question-tool): define private question flow`
- `1b62b7e ✨ feat(question-tool): add private Webview question flow`
- `a2e66d8 ✅ test(question-tool): cover private question flow`

Inspect `git status` and the latest log before resuming; documentation may be committed after this handover was last updated.

# Task Context

FrostPi needs an optional `question` tool that works entirely inside the VS Code Webview, including Remote SSH environments where an external Pi terminal UI is inconvenient. While answering, the conversation must remain visible and independently scrollable.

The authoritative requirements and accepted design are in:

- `changes/frostpi-question-tool/DEV_SPEC.md`
- `changes/frostpi-question-tool/PLAN.md`

The transport is FrostPi-private:

```text
bundled Pi tool writes authenticated request JSON
  -> ctx.ui.input(private marker) blocks the tool
  -> standard extension_ui_request reaches SessionRuntime
  -> Host validates marker/token/file and projects Question UI
  -> Webview submits structured answers
  -> standard extension_ui_response returns a JSON string
  -> tool validates, returns its normal result, and cleans the file
```

Binding constraints:

- Default disabled via `frostpi.questionTool.enabled`.
- Configuration applies only to a new/restarted Pi process.
- No changes under `packages/pi-rpc`.
- No watcher, polling, response file, custom RPC event, second pending-response coordinator, or generic form renderer.
- Existing project/global `question` registrations retain Pi load-order priority.
- Every request, including one question, requires explicit Submit after every answer is complete.
- One session may contain multiple pending Question requests.
- The UI is a bounded, collapsible bottom panel; conversation visibility is the primary layout requirement.
- Webview remount restores Host-owned pending requests but may lose drafts; process restart cancels pending requests.

# Implementation Map

- `apps/vscode/pi-extensions/question-tool.ts` — bundled Pi tool, atomic request publication, blocking input, result construction, cleanup.
- `apps/vscode/src/shared/question-tool/questionToolProtocol.ts` — dependency-free private marker/request/response contract and bounded validation.
- `apps/vscode/src/extension/question-tool/QuestionToolExtensionBridge.ts` — per-runtime token/temp directory, request loading, response serialization.
- `apps/vscode/src/extension/extension-ui/ExtensionUiCoordinator.ts` — sole pending response/cancellation owner for standard and Question requests.
- `apps/vscode/src/extension/sessions/SessionRuntime.ts` — process injection, event specialization, config applied state, lifecycle cleanup.
- `apps/vscode/src/webview/features/question-tool/QuestionToolHost.svelte` — dock, collapse, multiple-request switcher.
- `apps/vscode/src/webview/features/question-tool/QuestionForm.svelte` — answer editing, note, Cancel, explicit Submit.
- `apps/vscode/src/webview/features/question-tool/questionDraft.ts` — pure completion/submission state.

The private protocol intentionally has no Zod dependency because it is bundled into the Pi extension. Host-Webview input validation remains Zod-based in `apps/vscode/src/shared/bridge/webviewToHost.ts`. This keeps `dist/pi-extensions/question-tool.js` at 11.1 KiB instead of approximately 540 KiB.

# Evidence and Validation

Completed successfully:

```bash
pnpm check
```

Results:

- lint and typecheck passed;
- Svelte check: 0 errors, 0 warnings;
- `packages/pi-rpc`: 5 files / 14 tests passed;
- `apps/vscode`: 44 files / 235 tests passed;
- production build passed;
- Question extension artifact: 11.1 KiB;
- all bundle-size budgets passed.

Focused tests also passed:

```bash
pnpm --dir apps/vscode exec vitest run \
  test/unit/questionToolProtocol.test.ts \
  test/unit/questionToolExtension.test.ts \
  test/unit/QuestionToolExtensionBridge.test.ts \
  test/unit/questionDraft.test.ts \
  test/unit/ExtensionUiCoordinator.test.ts \
  test/unit/SessionRuntime.test.ts \
  test/unit/SessionRegistry.test.ts
```

The test suite includes a `SessionRuntime` case proving that the setting is applied to the started process, changing it marks restart required without mutating the process, and stop removes the request directory.

Packaging completed successfully:

```bash
pnpm package:vsix
pnpm verify:vsix
```

Verified artifact: `artifacts/FrostPi-0.8.0.vsix`, 78 entries, 2.35 MB. It contains `extension/dist/pi-extensions/question-tool.js`.

Known build output unrelated to this feature:

- Vite warns that Mermaid's vendor URL remains for runtime resolution; the package includes the vendor file.
- Node reports the repository's existing `shell: true` deprecation warning during scripts.

# Next Actions

1. Manual user validation when a VS Code host is available:

   - enable `frostpi.questionTool.enabled` and restart a session;
   - trigger single- and multi-question tool calls;
   - confirm explicit Submit, incomplete-submit disabling, Cancel, answer replacement, note, collapse/restore, and multiple request switching;
   - confirm the conversation remains scrollable while the panel is expanded;
   - check approximately 280 px width and light/dark/high-contrast themes;
   - repeat in Remote SSH if available.

2. Report manual validation as skipped if the execution environment cannot launch an interactive VS Code Webview. Do not claim it passed based on Svelte build/tests alone.

3. After manual validation, merge or squash the `wip/frostpi-question-tool` branch according to the user's preferred workflow.

# Risks

- Unexpected Pi process failure uses the existing session failure lifecycle; normal stop/restart explicitly cancels pending requests and removes the runtime temporary directory.
- Third-party extensions should not skip `question` registration merely because `PI_INSIDE_FROSTPI=1`; that variable is present even when FrostPi's bundled Question tool setting is disabled.
- Do not add Pi SDK, `typebox`, or Zod imports to `apps/vscode/pi-extensions/question-tool.ts` without reassessing VSIX dependencies and artifact size.
