import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { RpcCommandDescriptor } from "@frostime/pi-rpc";

export function promptSyntax(commands: readonly RpcCommandDescriptor[]): Extension {
  const known = new Set(commands.map((command) => command.name));
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, known);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = buildDecorations(update.view, known);
    }
  }, { decorations: (plugin) => plugin.decorations });
}

function buildDecorations(view: EditorView, commands: ReadonlySet<string>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let position = range.from;
    while (position <= range.to) {
      const line = view.state.doc.lineAt(position);
      decorateLine(line.from, line.text, commands, builder);
      if (line.to >= range.to) break;
      position = line.to + 1;
    }
  }
  return builder.finish();
}

export interface PromptToken {
  from: number;
  to: number;
  kind: "command" | "unknown-command" | "file-mention";
}

export function findPromptTokens(text: string, commands: ReadonlySet<string>): PromptToken[] {
  const tokens: PromptToken[] = [];
  const commandMatch = text.match(/^\s*\/([\w:.-]+)/);
  if (commandMatch?.index !== undefined) {
    const token = commandMatch[0];
    const slashOffset = token.indexOf("/");
    const command = commandMatch[1] ?? "";
    tokens.push({ from: slashOffset, to: slashOffset + command.length + 1, kind: commands.has(command) ? "command" : "unknown-command" });
  }

  const mentionPattern = /@"[^"\n]+"|@[^\s@]+/g;
  for (const match of text.matchAll(mentionPattern)) {
    if (match.index === undefined) continue;
    tokens.push({ from: match.index, to: match.index + match[0].length, kind: "file-mention" });
  }
  return tokens.sort((left, right) => left.from - right.from);
}

function decorateLine(from: number, text: string, commands: ReadonlySet<string>, builder: RangeSetBuilder<Decoration>): void {
  for (const token of findPromptTokens(text, commands)) {
    const className = token.kind === "command"
      ? "cm-prompt-command"
      : token.kind === "unknown-command"
      ? "cm-prompt-command-unknown"
      : "cm-prompt-mention";
    builder.add(from + token.from, from + token.to, Decoration.mark({ class: className }));
  }
}
