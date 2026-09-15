export type DiffLineKind = "addition" | "deletion" | "meta" | "comment" | "context";

export type DiffLinePresentation = {
  kind: DiffLineKind;
  marker: string;
  before: string;
  emphasis?: string;
  after: string;
  ending: string;
};

type ParsedDiffLine = {
  kind: DiffLineKind;
  content: string;
  ending: string;
  emphasized?: { start: number; end: number };
};

const MIN_SHARED_CHARACTERS = 2;
const MIN_SHARED_RATIO = 0.3;

export function presentDiff(source: string): DiffLinePresentation[] {
  const lines = splitDiffLines(source);
  markChangedSubstrings(lines);
  return lines.map(presentDiffLine);
}

export function renderDiffHtml(source: string): string {
  return presentDiff(source).map(renderDiffLine).join("");
}

function splitDiffLines(source: string): ParsedDiffLine[] {
  const rawLines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) ?? [];
  return rawLines.map((rawLine) => {
    const ending = rawLine.match(/(?:\r\n|\r|\n)$/)?.[0] ?? "";
    const content = ending ? rawLine.slice(0, -ending.length) : rawLine;
    return { kind: classifyDiffLine(content), content, ending };
  });
}

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "meta";
  if (/^(?:Index: |index|={3,}|-{3}|\*{3} |\+{3}|diff --git)/.test(line)) return "comment";
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  if (line.startsWith("!")) return "addition";
  return "context";
}

/**
 * Unified diffs place a deletion run directly before its replacement run.
 * Pair equal-sized runs by position and only emphasize pairs that retain enough
 * visible text; uncertain matches keep the safer whole-line highlight.
 */
function markChangedSubstrings(lines: ParsedDiffLine[]): void {
  for (let index = 0; index < lines.length;) {
    if (lines[index]?.kind !== "deletion") {
      index += 1;
      continue;
    }

    const deletionsStart = index;
    while (lines[index]?.kind === "deletion") index += 1;
    const additionsStart = index;
    while (lines[index]?.kind === "addition") index += 1;

    const deletionCount = additionsStart - deletionsStart;
    const additionCount = index - additionsStart;
    if (deletionCount !== additionCount) continue;

    for (let offset = 0; offset < deletionCount; offset += 1) {
      const deletion = lines[deletionsStart + offset]!;
      const addition = lines[additionsStart + offset]!;
      const ranges = findChangedRanges(deletion.content.slice(1), addition.content.slice(1));
      if (!ranges) continue;
      deletion.emphasized = { start: ranges.oldStart + 1, end: ranges.oldEnd + 1 };
      addition.emphasized = { start: ranges.newStart + 1, end: ranges.newEnd + 1 };
    }
  }
}

function findChangedRanges(oldText: string, newText: string): {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
} | undefined {
  let prefixLength = 0;
  while (
    prefixLength < oldText.length
    && prefixLength < newText.length
    && oldText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldText.length - prefixLength
    && suffixLength < newText.length - prefixLength
    && oldText[oldText.length - suffixLength - 1] === newText[newText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  if (prefixLength === oldText.length && prefixLength === newText.length) return undefined;

  const sharedText = oldText.slice(0, prefixLength) + oldText.slice(oldText.length - suffixLength);
  const sharedCharacters = sharedText.replace(/\s/g, "").length;
  const longestVisibleLength = Math.max(
    oldText.replace(/\s/g, "").length,
    newText.replace(/\s/g, "").length,
  );
  if (
    sharedCharacters < MIN_SHARED_CHARACTERS
    || longestVisibleLength === 0
    || sharedCharacters / longestVisibleLength < MIN_SHARED_RATIO
  ) {
    return undefined;
  }

  return {
    oldStart: prefixLength,
    oldEnd: oldText.length - suffixLength,
    newStart: prefixLength,
    newEnd: newText.length - suffixLength,
  };
}

function presentDiffLine(line: ParsedDiffLine): DiffLinePresentation {
  const markerLength = line.kind === "addition" || line.kind === "deletion" ? 1 : 0;
  const marker = markerLength ? line.content[0]! : "";
  if (!line.emphasized) {
    return { kind: line.kind, marker, before: line.content.slice(markerLength), after: "", ending: line.ending };
  }

  const emphasis = line.content.slice(line.emphasized.start, line.emphasized.end);
  return {
    kind: line.kind,
    marker,
    before: line.content.slice(markerLength, line.emphasized.start),
    ...(emphasis ? { emphasis } : {}),
    after: line.content.slice(line.emphasized.end),
    ending: line.ending,
  };
}

function renderDiffLine(line: DiffLinePresentation): string {
  const lineClass = line.kind === "context" ? "hljs-diff-line" : `hljs-diff-line hljs-${line.kind}`;
  const marker = line.marker
    ? `<span class="hljs-diff-marker">${escapeHtml(line.marker)}</span>`
    : "";
  const emphasis = line.emphasis
    ? `<span class="hljs-diff-emphasis">${escapeHtml(line.emphasis)}</span>`
    : "";
  return `<span class="${lineClass}">${marker}${escapeHtml(line.before)}${emphasis}${escapeHtml(line.after)}</span>${escapeHtml(line.ending)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
