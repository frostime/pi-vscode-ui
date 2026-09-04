import { normalizeSourceRange, type SourceRange } from "./annotationReviewModel";

export function readSourceSelection(
  root: HTMLElement,
  source: string,
  selection: Selection | null = window.getSelection(),
): SourceRange | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  if (root.textContent !== source) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const precedingText = document.createRange();
  precedingText.selectNodeContents(root);
  precedingText.setEnd(range.startContainer, range.startOffset);
  const start = precedingText.toString().length;

  return normalizeSourceRange(source, start, start + range.toString().length);
}
