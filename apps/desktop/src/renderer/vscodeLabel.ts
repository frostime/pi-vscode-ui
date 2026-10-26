export type VscodeLabelPart = { kind: "text"; text: string } | { kind: "icon"; className: string };

/**
 * VS Code icon-label syntax, including escaped markers and ~modifiers.
 * Reference: microsoft/vscode src/vs/base/browser/ui/iconLabel/iconLabels.ts.
 * Parts render as Svelte text/span nodes, never interpolated HTML.
 */
export function parseVscodeLabel(label: string): VscodeLabelPart[] {
  const parts: VscodeLabelPart[] = [];
  let position = 0;
  for (const match of label.matchAll(/(\\)?\$\(([A-Za-z0-9-]+)(?:~([A-Za-z]+))?\)/g)) {
    if (match.index > position) parts.push({ kind: "text", text: label.slice(position, match.index) });
    if (match[1]) {
      parts.push({ kind: "text", text: match[0].slice(1) });
    } else {
      parts.push({ kind: "icon", className: `codicon codicon-${match[2]}${match[3] ? ` codicon-modifier-${match[3]}` : ""}` });
    }
    position = match.index + match[0].length;
  }
  if (position < label.length) parts.push({ kind: "text", text: label.slice(position) });
  return parts;
}

export function vscodeLabelText(label: string): string {
  return parseVscodeLabel(label).filter((part) => part.kind === "text").map((part) => part.text).join("");
}
