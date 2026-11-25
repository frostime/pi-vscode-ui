/** Explicit Composer references; ordinary Markdown code is never a file attachment. */
export interface PromptReference {
  from: number;
  to: number;
  path: string;
  contentFrom: number;
  contentTo: number;
}

export function formatPromptReference(path: string, range?: { start: number; end: number }): string {
  const reference = range ? `${path}:${range.start}-${range.end}` : path;
  const ticks = "`".repeat(Math.max(0, ...[...reference.matchAll(/`+/g)].map(match => match[0].length)) + 1);
  const padded = reference.startsWith("`") || reference.endsWith("`")
    || (reference.startsWith(" ") && reference.endsWith(" ") && reference.trim().length > 0);
  return `ref:${ticks}${padded ? " " : ""}${reference}${padded ? " " : ""}${ticks}`;
}

function closingTicks(line: string, from: number, count: number): { from: number; to: number } | null {
  const pattern = /`+/g;
  pattern.lastIndex = from;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match[0].length === count) return { from: match.index, to: match.index + count };
  }
  return null;
}

export function findPromptReferences(text: string): PromptReference[] {
  if (!text.includes("ref:")) return [];
  const result: PromptReference[] = [];
  let fence: { character: string; count: number } | null = null;
  let end = text.indexOf("\n");
  if (end < 0) end = text.length;
  for (let position = 0; position < text.length;) {
    if (position > end) {
      end = text.indexOf("\n", position);
      if (end < 0) end = text.length;
    }
    if (position === 0 || text[position - 1] === "\n") {
      // Quoted fenced examples are source text too, not actionable references.
      const sourceLine = text.slice(position, end);
      const boundary = /^(?: {0,3}> ?)* {0,3}(`{3,}|~{3,})(.*)$/.exec(sourceLine);
      const run = boundary?.[1];
      if (fence) {
        if (run?.[0] === fence.character && run.length >= fence.count && !boundary?.[2]?.trim()) fence = null;
        position = end + 1;
        continue;
      }
      if (!fence && /^ {4,}(?:`{3,}|~{3,})/.test(sourceLine)) {
        position = end + 1;
        continue;
      }
      if (run) {
        fence = { character: run[0]!, count: run.length };
        position = end + 1;
        continue;
      }
    }
    if (text.startsWith("ref:", position) && (position === 0 || !/[\w]/.test(text[position - 1]!))) {
      const opening = /^`+/.exec(text.slice(position + 4))?.[0];
      if (opening) {
        const contentFrom = position + 4 + opening.length;
        const closing = closingTicks(text, contentFrom, opening.length);
        if (closing && closing.to <= end) {
          let path = text.slice(contentFrom, closing.from);
          if (path.startsWith(" ") && path.endsWith(" ") && path.trim()) path = path.slice(1, -1);
          if (path) result.push({ from: position, to: closing.to, path, contentFrom, contentTo: closing.from });
          position = closing.to;
          continue;
        }
      }
    }
    const inlineTicks = text[position] === "`" ? /^`+/.exec(text.slice(position))?.[0] : undefined;
    if (inlineTicks) {
      const after = position + inlineTicks.length;
      const closing = closingTicks(text, after, inlineTicks.length);
      const spansParagraphs = closing && /\n\s*\n/.test(text.slice(after, closing.from));
      position = closing && !spansParagraphs ? closing.to : after;
    } else position++;
  }
  return result;
}
