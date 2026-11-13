const MAX_PREVIEW_LENGTH = 160;

/**
 * One line of a reasoning block for its collapsed row, as tool rows show their target.
 * While the model thinks, the newest line shows what it is doing now; afterwards the
 * first line, usually the summary's heading, says what the block is about. Markdown
 * markers are dropped because the row shows plain text.
 */
export function reasoningPreview(text: string, streaming: boolean): string {
  const lines = text.split(/\r?\n/).map(plainLine).filter(Boolean);
  const line = (streaming ? lines.at(-1) : lines[0]) ?? "";
  if (line.length <= MAX_PREVIEW_LENGTH) return line;
  return streaming
    ? `…${line.slice(line.length - MAX_PREVIEW_LENGTH + 1).trimStart()}`
    : `${line.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s?|\d+[.)]\s+)/, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
