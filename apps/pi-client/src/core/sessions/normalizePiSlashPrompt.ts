/**
 * Pi `_tryExecuteExtensionCommand` uses `text.indexOf(" ")` only. Unicode spaces (NBSP, ideographic,
 * etc.) keep the arg glued to the command name, so the lookup misses and the text becomes a model prompt.
 * Collapse leading/trailing trim and any whitespace run after `/command` into a single ASCII space.
 */
export function normalizePiSlashPrompt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return trimmed;
  const match = /^\/(\S+)(\s+)([\s\S]*)$/.exec(trimmed);
  if (!match) return trimmed;
  const name = match[1] ?? "";
  const rest = (match[3] ?? "").replace(/^\s+/, "");
  return rest ? `/${name} ${rest}` : `/${name}`;
}

export function commandName(text: string): string | undefined {
  const normalized = normalizePiSlashPrompt(text);
  if (!normalized.startsWith("/")) return undefined;
  const space = normalized.indexOf(" ");
  return (space === -1 ? normalized.slice(1) : normalized.slice(1, space)) || undefined;
}
