/** Path reference in a Markdown code span. FrostPi inserts references only; never file bodies. */
export function formatFileMention(path: string, range?: { start: number; end: number }): string {
  return range ? `\`${path}:${range.start}-${range.end}\`` : `\`${path}\``;
}
