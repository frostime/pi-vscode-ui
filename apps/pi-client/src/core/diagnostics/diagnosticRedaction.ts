import { STDERR_EXCERPT_MARKER } from "@frostime/pi-rpc";

const MAX_DIAGNOSTIC_ERROR_LENGTH = 2_000;

// Redaction is a backstop for text that has to be recorded (errors, log lines). It
// recognizes credentials by shape; it cannot recognize prompts or file contents, so
// third-party output such as Pi's stderr is left out of exported diagnostics instead.
//
// The text is attacker-influenced (a failing Pi prints what it likes) and redaction runs
// synchronously in the Host, so every pattern here must stay linear: a greedy run that
// can fail afterwards is anchored by a lookbehind to start only once per run.
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const URL_CREDENTIALS = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*):\/\/([^\s/@:]+):([^\s/@]+)@/gi;
const BEARER_TOKEN = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const QUOTED_VALUE = `"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?`;
// `Authorization: Basic dXNlcjpwYXNz` carries its secret after a scheme word.
const AUTHORIZATION_HEADER = new RegExp(
  `\\b((?:proxy-)?authorization)(["']?\\s*[:=]\\s*)(${QUOTED_VALUE}|(?:[A-Za-z][\\w-]*[ \\t]+)?\\S+)`,
  "gi",
);
// Cookie values are `;`-separated pairs: take the quoted value or the rest of the line.
const COOKIE_HEADER = new RegExp(`\\b((?:set-)?cookie)(["']?\\s*[:=]\\s*)(${QUOTED_VALUE}|[^\\n]*)`, "gi");
const URL_QUERY_SECRET = /([?&](?:key|sig|signature|code)=)[^&\s#"']+/gi;
const KNOWN_TOKEN = new RegExp([
  "\\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}",
  "\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}",
  "\\bgithub_pat_[A-Za-z0-9_]{20,}",
  "\\bglpat-[A-Za-z0-9_-]{16,}",
  "\\bxox[abeprs]-[A-Za-z0-9-]{10,}",
  "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
  "\\bAIza[0-9A-Za-z_-]{30,}",
  "\\b(?:gsk|hf|r8)_[A-Za-z0-9]{20,}",
  "\\b(?:xai|pplx|nvapi)-[A-Za-z0-9_-]{20,}",
  "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}",
].join("|"), "g");

const NAME = /[\w.-]+/g;
const SECRET_WORD = /api[_-]?key|apikey|token|secret|passw(?:or)?d|passphrase|credential|private[_-]?key|access[_-]?key/i;
// A count is not a credential: `input_tokens: 1200`, `max_tokens=4096`, `tokenCount: 12`.
const TOKEN_COUNT_NAME = /tokens$|token[_-]?(?:count|limit|usage|budget)s?$/i;
const COUNT_VALUE = /^\d+(?:\.\d+)?[,;)\]}]*$/;
const NAME_END = /(["']?)(\s*[:=]\s*|\s+)/y;
const ASSIGNED_VALUE = new RegExp(`${QUOTED_VALUE}|\\S+`, "y");

export function redactError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactDiagnosticText(text).slice(0, 12_000);
}

export function redactDiagnosticText(text: string): string {
  return redactSecretAssignments(
    text
      .replace(PRIVATE_KEY_BLOCK, "<redacted private key>")
      .replace(URL_CREDENTIALS, "$1://<credentials>@")
      .replace(AUTHORIZATION_HEADER, "$1$2<redacted>")
      .replace(COOKIE_HEADER, "$1$2<redacted>")
      .replace(BEARER_TOKEN, "$1<redacted>"),
  )
    .replace(URL_QUERY_SECRET, "$1<redacted>")
    .replace(KNOWN_TOKEN, "<redacted>");
}

/**
 * A session error as exported diagnostics may show it: bounded, credential-redacted and
 * without the Pi stderr excerpt that RPC failures append to their message.
 */
export function diagnosticErrorText(error: string): string {
  const marker = error.indexOf(STDERR_EXCERPT_MARKER);
  const message = marker < 0 ? error : `${error.slice(0, marker).replace(/[.\s]+$/, "")} (Pi stderr omitted)`;
  return redactDiagnosticText(message).slice(0, MAX_DIAGNOSTIC_ERROR_LENGTH);
}

/**
 * Redacts the value assigned to any name that contains a secret word: `NAME=value`,
 * `"name": "value"`, `name: value` and `--name value`. An unquoted value runs to the
 * next whitespace, whatever punctuation it contains. One forward pass over the names
 * keeps this linear, and a value is always rescanned when its own name was harmless
 * (`env: API_KEY=…`).
 */
function redactSecretAssignments(text: string): string {
  let output = "";
  let copied = 0;
  NAME.lastIndex = 0;
  for (let match = NAME.exec(text); match; match = NAME.exec(text)) {
    const name = match[0];
    if (!SECRET_WORD.test(name)) continue;

    NAME_END.lastIndex = match.index + name.length;
    const end = NAME_END.exec(text);
    if (!end) continue;
    // Without `:` or `=`, only a command-line flag counts (`--api-key value`); prose
    // such as "unexpected token }" stays readable.
    if (!/[:=]/.test(end[2]!) && !(name.startsWith("-") && !end[1])) continue;

    const valueStart = NAME_END.lastIndex;
    ASSIGNED_VALUE.lastIndex = valueStart;
    const value = ASSIGNED_VALUE.exec(text)?.[0];
    if (!value) continue;
    if (TOKEN_COUNT_NAME.test(name) && COUNT_VALUE.test(value)) continue;

    const quote = /^["']/.test(value) ? value[0]! : "";
    const closing = quote && value.length > 1 && value.endsWith(quote) ? quote : "";
    output += `${text.slice(copied, valueStart)}${quote}<redacted>${closing}`;
    copied = valueStart + value.length;
    NAME.lastIndex = copied;
  }
  return output + text.slice(copied);
}
