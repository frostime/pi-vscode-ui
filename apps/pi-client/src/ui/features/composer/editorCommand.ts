/** Returns the external-editor prefill when `text` is a FrostPi `/editor` submission; otherwise null. */
export function composerEditorPrefill(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "/editor") return "";
  if (!trimmed.startsWith("/editor")) return null;
  const boundary = trimmed.charAt("/editor".length);
  if (boundary !== "" && !/\s/.test(boundary)) return null;
  return trimmed.slice("/editor".length).trimStart();
}
