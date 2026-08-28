/**
 * Split a raw launch-arguments string into argv tokens.
 *
 * Deliberately a tokenizer, not a validator: the resulting tokens are appended
 * to the Pi launch command as-is, and the Pi CLI owns interpretation and error
 * reporting. Tokenizer rules (documented in the launcher input box):
 *
 * - Whitespace runs separate tokens.
 * - Double quotes group whitespace into one token and are removed (`"a b"` -> `a b`).
 * - Backslash is a literal character, so Windows paths need no escaping.
 * - Unclosed quotes run to the end of the input (lenient, never an error).
 * - Empty tokens (`""`) are dropped: they carry no meaning to the Pi CLI.
 */
export function parseLaunchArguments(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let started = false;
  const flush = (): void => {
    if (started && current.length > 0) tokens.push(current);
    current = "";
    started = false;
  };
  for (const char of input) {
    if (char === '"') {
      started = true;
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
    started = true;
  }
  flush();
  return tokens;
}
