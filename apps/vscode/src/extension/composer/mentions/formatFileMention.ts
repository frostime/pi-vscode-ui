/** Pi-compatible path mention. FrostPi inserts references only; never file bodies. */
export function formatFileMention(path: string, range?: { start: number; end: number }): string {
  const base = /\s/.test(path) ? `@"${path.replaceAll('"', '\\"')}"` : `@${path}`;
  return range ? `${base}:${range.start}-${range.end}` : base;
}
