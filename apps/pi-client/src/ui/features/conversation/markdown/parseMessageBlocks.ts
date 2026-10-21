export type MarkdownSegment =
  | { type: "markdown"; text: string }
  | { type: "mermaid"; text: string };

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})([^\n`]*)$/;

/**
 * Split message text into markdown segments and complete mermaid fences.
 * Incomplete fences stay inside markdown so streaming does not mount a diagram early.
 */
export function parseMessageBlocks(content: string): MarkdownSegment[] {
  if (!content) return [{ type: "markdown", text: "" }];

  const lines = content.split("\n");
  const segments: MarkdownSegment[] = [];
  let markdownLines: string[] = [];
  let fence: {
    marker: string;
    indent: string;
    openLine: string;
    body: string[];
    precedingMarkdown: string[];
  } | null = null;

  const flushMarkdown = (linesToFlush: string[]): void => {
    if (linesToFlush.length === 0) return;
    segments.push({ type: "markdown", text: linesToFlush.join("\n") });
  };

  for (const line of lines) {
    if (!fence) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        const marker = open[2]!;
        const language = open[3]!.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        if (language === "mermaid") {
          fence = {
            marker,
            indent: open[1]!,
            openLine: line,
            body: [],
            precedingMarkdown: markdownLines,
          };
          markdownLines = [];
          continue;
        }
      }
      markdownLines.push(line);
      continue;
    }

    const close = line.match(/^( {0,3})(`{3,}|~{3,})[ \t]*$/);
    if (
      close
      && close[2]![0] === fence.marker[0]
      && close[2]!.length >= fence.marker.length
    ) {
      flushMarkdown(fence.precedingMarkdown);
      segments.push({ type: "mermaid", text: fence.body.join("\n") });
      fence = null;
      continue;
    }

    fence.body.push(line);
  }

  if (fence) {
    // Incomplete mermaid fence: restore raw source into markdown for streaming.
    markdownLines = [...fence.precedingMarkdown, fence.openLine, ...fence.body, ...markdownLines];
  }
  flushMarkdown(markdownLines);
  return segments.length > 0 ? segments : [{ type: "markdown", text: "" }];
}
