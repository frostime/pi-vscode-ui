<script lang="ts">
  import {
    acceptCompletion,
    autocompletion,
    completionKeymap,
    startCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView, keymap, placeholder as editorPlaceholder, tooltips } from "@codemirror/view";
  import type { RpcCommandDescriptor } from "@frostime/pi-rpc";
  import { onMount } from "svelte";

  import { shouldStartPromptCompletion } from "./completionPolicy";
  import { withFrostPiCommands } from "./frostPiCommands";
  import { requestWorkspaceFileSuggestions } from "./fileSuggestionClient";
  import { indentPromptWithTab, insertPromptNewline, outdentPromptWithShiftTab } from "./promptEditing";
  import { promptSyntax } from "./promptSyntax";
  import { workspaceMentionEdit, workspaceMentionReplaceTo } from "./workspaceMentionCompletion";

  let {
    sessionId,
    value,
    commands,
    placeholder,
    onchange,
    onsubmit,
    onpasteimages,
  }: {
    sessionId: string;
    value: string;
    commands: RpcCommandDescriptor[];
    placeholder: string;
    onchange: (value: string) => void;
    onsubmit: () => void;
    onpasteimages: (files: File[]) => void | Promise<void>;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  let applyingExternal = false;
  const syntaxCompartment = new Compartment();
  const completionCompartment = new Compartment();

  export function focus(): void {
    view?.focus();
  }

  onMount(() => {
    view = createEditor();
    return () => view?.destroy();
  });

  $effect(() => {
    const editor = view;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    applyingExternal = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    applyingExternal = false;
  });

  $effect(() => {
    const allCommands = withFrostPiCommands(commands);
    const activeSessionId = sessionId;
    const editor = view;
    if (!editor) return;
    editor.dispatch({
      effects: [
        syntaxCompartment.reconfigure(promptSyntax(allCommands)),
        completionCompartment.reconfigure(completionExtension(allCommands, activeSessionId)),
      ],
    });
  });

  function createEditor(): EditorView {
    return new EditorView({ state: createState(value), parent: host });
  }

  function createState(doc: string): EditorState {
    const allCommands = withFrostPiCommands(commands);
    return EditorState.create({
      doc,
      extensions: [
        history(),
        // Mount completion outside the editor so composer/editor geometry cannot clip long lists.
        tooltips({ parent: document.body }),
        keymap.of([
          ...completionKeymap,
          { key: "Tab", run: acceptCompletion },
          { key: "Tab", run: indentPromptWithTab, shift: outdentPromptWithShiftTab },
          { key: "Enter", run: insertPromptNewline },
          ...historyKeymap,
          { key: "Mod-Enter", run: () => { onsubmit(); return true; } },
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Message Pi" }),
        editorPlaceholder(placeholder),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingExternal) return;
          onchange(update.state.doc.toString());
          const cursor = update.state.selection.main.head;
          if (shouldStartPromptCompletion(update.state.doc.toString(), cursor)) {
            queueMicrotask(() => {
              const editor = update.view;
              const currentCursor = editor.state.selection.main.head;
              if (shouldStartPromptCompletion(editor.state.doc.toString(), currentCursor)) startCompletion(editor);
            });
          }
        }),
        EditorView.domEventHandlers({
          paste: (event) => {
            const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
            if (!files.length) return false;
            event.preventDefault();
            void onpasteimages(files);
            return true;
          },
        }),
        syntaxCompartment.of(promptSyntax(allCommands)),
        completionCompartment.of(completionExtension(allCommands, sessionId)),
        EditorView.theme({
          "&": { backgroundColor: "transparent", color: "var(--frost-text)" },
          ".cm-scroller": {
            fontFamily: "var(--frostpi-chat-composer-font-family, var(--font-ui))",
            fontSize: "var(--frostpi-chat-composer-font-size, var(--font-size))",
            lineHeight: "1.48",
            overflowX: "hidden",
            overflowY: "auto",
          },
          ".cm-content": {
            minHeight: "72px", /* keep in sync with --composer-editor-min-height */
            padding: "13px 14px 11px",
            caretColor: "var(--frost-text)",
          },
          ".cm-line": { padding: "0" },
          ".cm-gutters": { display: "none" },
          ".cm-activeLine": { backgroundColor: "transparent" },
          ".cm-selectionBackground, ::selection": { backgroundColor: "var(--vscode-editor-selectionBackground) !important" },
        }),
      ],
    });
  }
</script>

<div class="prompt-editor" bind:this={host}></div>

<script lang="ts" module>
  function completionExtension(commands: RpcCommandDescriptor[], sessionId: string) {
    return autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 40,
      maxRenderedOptions: 100,
      optionClass: (completion) => completion.type === "frostpi-status" ? "frostpi-completion-status" : "",
      override: [commandCompletion(commands), fileCompletion(sessionId)],
    });
  }

  function commandCompletion(commands: RpcCommandDescriptor[]) {
    return (context: CompletionContext): CompletionResult | null => {
      const match = context.matchBefore(/\/[\w:#.-]*/);
      if (!match) return null;
      const line = context.state.doc.lineAt(match.from);
      if (line.text.slice(0, match.from - line.from).trim().length > 0) return null;
      const options: Completion[] = commands.map((command) => ({
        label: `/${command.name}`,
        detail: command.source,
        apply: `/${command.name} `,
      }));
      return { from: match.from, options, validFor: /^\/[\w:#.-]*$/ };
    };
  }

  function fileCompletion(sessionId: string) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const match = context.matchBefore(/@(?:"[^"\n]*|[^\s@]*)/);
      if (!match) return null;
      const raw = match.text.slice(1);
      const query = raw.startsWith('"') ? raw.slice(1) : raw;
      const request = requestWorkspaceFileSuggestions(sessionId, query, 32);
      context.addEventListener("abort", request.cancel, { onDocChange: true });
      const result = await request.promise;
      if (context.aborted) return null;

      // Specials first when the query is empty or still matches (Copilot-style @ menu).
      const options: Completion[] = (result.specials ?? []).map((item, index) => ({
        label: item.label,
        detail: item.detail,
        apply: item.insertText,
        boost: 2_000 - index,
      }));
      for (const item of result.items) {
        options.push({
          label: `${item.name}${item.isDirectory ? "/" : ""}`,
          detail: item.directory || "workspace root",
          type: item.isDirectory ? "folder" : "file",
          apply: (view, _completion, from, to) => {
            const edit = workspaceMentionEdit(item.path, item.isDirectory);
            const replaceTo = workspaceMentionReplaceTo(match.text, to, view.state.sliceDoc(to, to + 1));
            view.dispatch({
              changes: { from, to: replaceTo, insert: edit.text },
              selection: { anchor: from + edit.cursorOffset },
            });
          },
        });
      }
      if (!options.length) {
        options.push({
          label: result.error ?? "No workspace files found",
          detail: result.error ? "file search error" : "try another path fragment",
          type: "frostpi-status",
          boost: -10_000,
          apply: () => {},
        });
      }
      return {
        from: match.from,
        options,
        validFor: /^@(?:"[^"\n]*|[^\s@]*)$/,
        filter: false,
      };
    };
  }
</script>
