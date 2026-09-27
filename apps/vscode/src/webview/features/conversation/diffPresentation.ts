/**
 * Presentation model for unified-diff text: line classification plus word-level
 * intra-line emphasis. Both surfaces consume it — Markdown `diff`/`patch` fences
 * via `renderDiffHtml`, tool-card change previews via `presentDiff` — so they show
 * one algorithm with different chrome.
 */

export type DiffLineKind = "addition" | "deletion" | "meta" | "comment" | "context";

/** A maximal same-emphasis run of a rendered diff line. */
export type DiffSegment = {
  text: string;
  emphasized: boolean;
};

export type DiffLinePresentation = {
  kind: DiffLineKind;
  marker: string;
  segments: DiffSegment[];
  ending: string;
};

type ParsedDiffLine = {
  kind: DiffLineKind;
  marker: string;
  body: string;
  ending: string;
  /** Per-character emphasis marks over `body`; absent means no intra-line emphasis. */
  flags?: Uint8Array;
};

/**
 * Adjacent deletion/addition runs are tokenized as word streams and aligned with an
 * exact LCS, so a line can carry several separate changed ranges and paired runs may
 * differ in size. Block-local scope keeps this cheap; `MAX_...` guards bound the worst case.
 */
export function presentDiff(source: string): DiffLinePresentation[] {
  const lines = splitDiffLines(source);
  markChangedTokens(lines);
  return lines.map(presentDiffLine);
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

/**
 * Added/removed line counts for a tool card header, classified exactly like the rendered
 * Changes body (file headers and hunk markers never count). Undefined when the diff shows
 * no edited line, e.g. a no-op write.
 */
export function diffStats(source: string): DiffStats | undefined {
  let additions = 0;
  let deletions = 0;
  for (const line of splitDiffLines(source)) {
    if (line.kind === "addition") additions += 1;
    else if (line.kind === "deletion") deletions += 1;
  }
  return additions + deletions > 0 ? { additions, deletions } : undefined;
}

export function renderDiffHtml(source: string): string {
  return presentDiff(source).map(renderDiffLineHtml).join("");
}

// ---- line model ----

function splitDiffLines(source: string): ParsedDiffLine[] {
  const rawLines = source.split(/\r\n|\r|\n/);
  if (rawLines[rawLines.length - 1] === "") rawLines.pop();
  const terminated = source.endsWith("\n") || source.endsWith("\r");
  return rawLines.map((content, index) => {
    const kind = classifyDiffLine(content);
    const marked = kind === "addition" || kind === "deletion";
    return {
      kind,
      marker: marked ? content.slice(0, 1) : "",
      body: marked ? content.slice(1) : content,
      ending: index < rawLines.length - 1 || terminated ? "\n" : "",
    };
  });
}

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "meta";
  if (/^(?:Index: |index|={3,}|-{3}|\*{3} |\+{3}|diff --git)/.test(line)) return "comment";
  if (line.startsWith("+") || line.startsWith("!")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

// ---- word-level emphasis ----

const MAX_WORD_DIFF_BLOCK_TOKENS = 800;
const MAX_EMPHASIZED_VISIBLE_SHARE = 0.75;

/**
 * Latin words and numbers, single CJK characters (prose diffs from AI discussions have
 * no word boundaries), punctuation and whitespace runs, each as one token. Any other
 * Unicode code point is still a token so no text is skipped. Newlines are separate
 * tokens so block alignment stays anchored to line structure.
 */
const TOKEN_PATTERN = /\r\n|\n|\r|\w+|[\u4e00-\u9fff\uf900-\ufaff]|[\u3000-\u303f\uff01-\uff5e]|[!-/:-@[-`{-~]|\s+|[\s\S]/gu;

function markChangedTokens(lines: ParsedDiffLine[]): void {
  for (let index = 0; index < lines.length;) {
    if (lines[index]?.kind !== "deletion") {
      index += 1;
      continue;
    }
    const deletionsStart = index;
    while (lines[index]?.kind === "deletion") index += 1;
    const additionsStart = index;
    while (lines[index]?.kind === "addition") index += 1;
    const additionsEnd = index;
    const deletions = lines.slice(deletionsStart, additionsStart);
    const additions = lines.slice(additionsStart, additionsEnd);
    if (deletions.length === 0 || additions.length === 0) continue;
    markWordDiff(deletions, additions);
  }
}

function markWordDiff(deletions: ParsedDiffLine[], additions: ParsedDiffLine[]): void {
  const oldStream = blockTokenStream(deletions);
  const newStream = blockTokenStream(additions);
  if (oldStream.tokens.length + newStream.tokens.length > MAX_WORD_DIFF_BLOCK_TOKENS) return;

  const { oldMarks, newMarks } = diffTokenMarks(oldStream.tokens, newStream.tokens);
  applyTokenMarks(deletions, oldStream, oldMarks);
  applyTokenMarks(additions, newStream, newMarks);
}

/** A block's concatenated token stream plus, per token, the owning line and its offset there. */
type BlockTokenStream = {
  tokens: string[];
  owners: number[];
  starts: number[];
};

function blockTokenStream(block: ParsedDiffLine[]): BlockTokenStream {
  const tokens: string[] = [];
  const owners: number[] = [];
  const starts: number[] = [];
  block.forEach((line, lineIndex) => {
    for (const match of line.body.matchAll(TOKEN_PATTERN)) {
      tokens.push(match[0]);
      owners.push(lineIndex);
      starts.push(match.index);
    }
    // Separator between block lines; owner -1 marks it as not belonging to any line.
    if (lineIndex < block.length - 1) {
      tokens.push("\n");
      owners.push(-1);
      starts.push(-1);
    }
  });
  return { tokens, owners, starts };
}

/**
 * Exact LCS over tokens; every token outside the longest common subsequence is marked
 * as changed. Token counts are capped by MAX_WORD_DIFF_BLOCK_TOKENS, so the O(n·m)
 * table stays small — no Myers machinery needed at this scale.
 */
function diffTokenMarks(oldTokens: string[], newTokens: string[]): {
  oldMarks: Uint8Array;
  newMarks: Uint8Array;
} {
  const oldLength = oldTokens.length;
  const newLength = newTokens.length;
  const commonSuffixCounts: Uint16Array[] = Array.from(
    { length: oldLength + 1 },
    () => new Uint16Array(newLength + 1),
  );
  for (let oldIndex = oldLength - 1; oldIndex >= 0; oldIndex--) {
    const row = commonSuffixCounts[oldIndex]!;
    const nextRow = commonSuffixCounts[oldIndex + 1]!;
    for (let newIndex = newLength - 1; newIndex >= 0; newIndex--) {
      row[newIndex] = oldTokens[oldIndex] === newTokens[newIndex]
        ? nextRow[newIndex + 1]! + 1
        : Math.max(nextRow[newIndex]!, row[newIndex + 1]!);
    }
  }

  const oldMarks = new Uint8Array(oldLength).fill(1);
  const newMarks = new Uint8Array(newLength).fill(1);
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLength && newIndex < newLength) {
    if (oldTokens[oldIndex] === newTokens[newIndex]) {
      oldMarks[oldIndex] = 0;
      newMarks[newIndex] = 0;
      oldIndex += 1;
      newIndex += 1;
    } else if (commonSuffixCounts[oldIndex + 1]![newIndex]! >= commonSuffixCounts[oldIndex]![newIndex + 1]!) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return { oldMarks, newMarks };
}

function applyTokenMarks(
  block: ParsedDiffLine[],
  stream: BlockTokenStream,
  marks: Uint8Array,
): void {
  const flagsPerLine = block.map((line) => new Uint8Array(line.body.length));
  stream.tokens.forEach((token, tokenIndex) => {
    const owner = stream.owners[tokenIndex]!;
    if (!marks[tokenIndex] || owner < 0) return;
    const flags = flagsPerLine[owner]!;
    const start = stream.starts[tokenIndex]!;
    for (let offset = 0; offset < token.length; offset++) flags[start + offset] = 1;
  });

  block.forEach((line, lineIndex) => {
    const flags = flagsPerLine[lineIndex]!;
    // A line whose emphasis covers nearly all visible text is a rewrite, not an edit;
    // word-level marks would only add noise over the whole-line background.
    if (!coversMostVisibleText(line.body, flags)) line.flags = flags;
  });
}

function coversMostVisibleText(body: string, flags: Uint8Array): boolean {
  let visible = 0;
  let emphasized = 0;
  for (let index = 0; index < body.length; index++) {
    if (/\s/.test(body[index]!)) continue;
    visible += 1;
    if (flags[index]) emphasized += 1;
  }
  return visible > 0 && emphasized / visible >= MAX_EMPHASIZED_VISIBLE_SHARE;
}

// ---- presentation ----

function presentDiffLine(line: ParsedDiffLine): DiffLinePresentation {
  return {
    kind: line.kind,
    marker: line.marker,
    segments: buildSegments(line.body, line.flags),
    ending: line.ending,
  };
}

function buildSegments(body: string, flags: Uint8Array | undefined): DiffSegment[] {
  if (!flags || body.length === 0) return [{ text: body, emphasized: false }];
  const segments: DiffSegment[] = [];
  let start = 0;
  for (let index = 1; index <= body.length; index++) {
    if (index === body.length || flags[index] !== flags[start]) {
      segments.push({ text: body.slice(start, index), emphasized: flags[start] === 1 });
      start = index;
    }
  }
  return segments;
}

function renderDiffLineHtml(line: DiffLinePresentation): string {
  const lineClass = line.kind === "context" ? "hljs-diff-line" : `hljs-diff-line hljs-${line.kind}`;
  const marker = line.marker
    ? `<span class="hljs-diff-marker">${escapeHtml(line.marker)}</span>`
    : "";
  const content = line.segments
    .map((segment) => (segment.emphasized
      ? `<span class="hljs-diff-emphasis">${escapeHtml(segment.text)}</span>`
      : escapeHtml(segment.text)))
    .join("");
  return `<span class="${lineClass}">${marker}<span class="hljs-diff-content">${content}</span></span>${escapeHtml(line.ending)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
