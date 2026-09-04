export interface AnnotationRange {
  id: string;
  start: number;
  end: number;
}

export interface ResponseAnnotation extends AnnotationRange {
  comment: string;
  createdOrder: number;
}

export type PendingAnnotation =
  | { mode: "create"; start: number; end: number; comment: string }
  | { mode: "edit"; annotationId: string; start: number; end: number; comment: string };

export interface AnnotationReviewDraft {
  source: string;
  annotations: ResponseAnnotation[];
  pending: PendingAnnotation | null;
  activeAnnotationId: string | null;
  nextCreatedOrder: number;
}

export interface AnnotationSourceSegment {
  start: number;
  end: number;
  text: string;
  annotationIds: string[];
}

export interface SourceRange {
  start: number;
  end: number;
}

export function normalizeSourceRange(source: string, firstOffset: number, secondOffset: number): SourceRange | null {
  let start = Math.max(0, Math.min(source.length, Math.min(firstOffset, secondOffset)));
  let end = Math.max(0, Math.min(source.length, Math.max(firstOffset, secondOffset)));

  while (start < end && isWhitespace(source[start])) start += 1;
  while (end > start && isWhitespace(source[end - 1])) end -= 1;

  return start < end ? { start, end } : null;
}

export function sortAnnotations(annotations: readonly ResponseAnnotation[]): ResponseAnnotation[] {
  return [...annotations].sort((left, right) =>
    left.start - right.start || left.end - right.end || left.createdOrder - right.createdOrder,
  );
}

export function segmentAnnotationSource(
  source: string,
  ranges: readonly AnnotationRange[],
): AnnotationSourceSegment[] {
  if (!source) return [];

  const validRanges = ranges.filter((range) =>
    Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.start < range.end
    && range.end <= source.length,
  );
  const boundaries = new Set([0, source.length]);
  for (const range of validRanges) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }

  const offsets = [...boundaries].sort((left, right) => left - right);
  const segments: AnnotationSourceSegment[] = [];
  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start === undefined || end === undefined || start === end) continue;
    segments.push({
      start,
      end,
      text: source.slice(start, end),
      annotationIds: validRanges
        .filter((range) => range.start < end && range.end > start)
        .map((range) => range.id),
    });
  }
  return segments;
}

export function compactAnnotationQuote(text: string, maximumLength = 120): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (compact.length <= maximumLength) return compact;
  return `${compact.slice(0, Math.max(0, maximumLength - 1))}…`;
}

export function pendingAnnotationHasChanges(review: AnnotationReviewDraft): boolean {
  const pending = review.pending;
  if (!pending) return false;
  if (pending.mode === "create") return Boolean(pending.comment.trim());
  const savedComment = review.annotations.find(({ id }) => id === pending.annotationId)?.comment ?? "";
  return pending.comment.trim() !== savedComment;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}
