const MAX_ALT_CAPTION_LENGTH = 160;

/** Prefer authored titles; use concise alt text as a discoverable fallback caption. */
export function markdownImageCaption(title: string | undefined, alt: string): string | undefined {
  const explicitTitle = title?.trim();
  if (explicitTitle) return explicitTitle;

  const fallback = alt.trim();
  return fallback && Array.from(fallback).length <= MAX_ALT_CAPTION_LENGTH ? fallback : undefined;
}
