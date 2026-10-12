/**
 * Output masking and safe error text.
 *
 * Masking rules (required for every phase):
 * - short values are fully hidden so prefix/suffix can never reconstruct them;
 * - sufficiently long values keep a short fixed prefix/suffix around one fixed
 *   mask word (no per-value mask width that could reveal length);
 * - the same fixed mask applies to environment variable names.
 *
 * Adapted in part from the MIT-licensed source snapshot `pi-provider-usage`
 * (`src/core.ts`, `sanitizeDisplayText` and `redactUsageError`); attribution
 * is recorded in UPSTREAM.md.
 */

/** Fixed mask word; never replaced by value-length-derived text. */
const FIXED_MASK = "[masked]";

/** Values shorter than this threshold are fully hidden. */
const PARTIAL_MASK_MIN_LENGTH = 12;
/** Fixed fragment length kept on each side of the fixed mask. */
const PARTIAL_MASK_EDGE_CHARS = 3;

/** Masks a credential-bearing value before any human-readable output. */
export function maskSecret(value: string): string {
  if (value.length === 0) return FIXED_MASK;
  if (value.length < PARTIAL_MASK_MIN_LENGTH) return FIXED_MASK;
  return `${value.slice(0, PARTIAL_MASK_EDGE_CHARS)}…${FIXED_MASK}…${value.slice(-PARTIAL_MASK_EDGE_CHARS)}`;
}

/** Masks an environment variable name before any human-readable output. */
export function maskEnvName(value: string): string {
  return maskSecret(value);
}

/** Strips control characters and collapses whitespace for safe display text. */
export function sanitizeDisplayText(value: string, maxChars = 160): string {
  let result = "";
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index) ?? 0;
    const character = String.fromCodePoint(codePoint);
    if (codePoint === 0x1b || codePoint === 0x9b || codePoint === 0x9d) {
      index = skipTerminalEscape(value, index, codePoint);
      continue;
    }
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) result += " ";
      index += character.length;
      continue;
    }
    result += character;
    index += character.length;
  }
  return truncate(result.replace(/\s+/gu, " ").trim(), maxChars);
}

/**
 * Redacts known secrets from text destined for error/display output:
 * exact secret matches, bearer tokens, and token-bearing JSON fields.
 * Compared with booleans in tests; failure output must stay maskable.
 */
export function redactWithSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), "gu"), "<redacted>");
  }
  redacted = redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer <redacted>")
    .replace(/"(?:access_token|refresh_token|api_key)"\s*:\s*"[^"]+"/giu, (match) => {
      const separator = match.indexOf(":");
      return `${match.slice(0, separator + 1)}"<redacted>"`;
    });
  return sanitizeDisplayText(redacted, 600);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function skipTerminalEscape(value: string, start: number, codePoint: number): number {
  let index = start + 1;
  const next = value.charCodeAt(index);
  const isOsc = codePoint === 0x9d || (codePoint === 0x1b && next === 0x5d);
  if (isOsc) {
    if (codePoint === 0x1b) index += 1;
    while (index < value.length) {
      const current = value.charCodeAt(index);
      if (current === 0x07) return index + 1;
      if (current === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
      index += 1;
    }
    return index;
  }
  const isCsi = codePoint === 0x9b || (codePoint === 0x1b && next === 0x5b);
  if (isCsi) {
    if (codePoint === 0x1b) index += 1;
    while (index < value.length) {
      const current = value.charCodeAt(index);
      index += 1;
      if (current >= 0x40 && current <= 0x7e) break;
    }
    return index;
  }
  return Math.min(value.length, start + (codePoint === 0x1b ? 2 : 1));
}
