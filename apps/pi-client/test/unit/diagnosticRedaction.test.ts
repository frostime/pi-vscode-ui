import { describe, expect, it } from "vitest";

import { diagnosticErrorText, redactDiagnosticText, redactError } from "../../src/core/diagnostics/diagnosticRedaction.js";

describe("diagnostic redaction", () => {
  it("removes environment and URL credentials", () => {
    const redacted = redactDiagnosticText("API_TOKEN=abc https://alice:secret@proxy.example Bearer xyz.123");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("alice");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("xyz.123");
    expect(redacted).toContain("<redacted>");
  });

  it.each([
    ["a JSON field", '{"apiKey":"zz-live-0123456789","model":"m"}', '{"apiKey":"<redacted>","model":"m"}'],
    ["a spaced JSON field", '{ "api_key" : "zz-live-0123456789" }', '{ "api_key" : "<redacted>" }'],
    ["a single-quoted field", "{ 'client_secret': 'zz 0123 with spaces' }", "{ 'client_secret': '<redacted>' }"],
    ["an environment assignment", "OPENAI_API_KEY=zz-live-0123456789 pi --mode rpc", "OPENAI_API_KEY=<redacted> pi --mode rpc"],
    ["a YAML-style field", "password: hunter2", "password: <redacted>"],
    ["a command-line flag", "pi --api-key zz-live-0123456789 --model m", "pi --api-key <redacted> --model m"],
    ["an authorization header", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization: <redacted>"],
    ["a JSON authorization header", '{"authorization":"Bearer abc.def","x":1}', '{"authorization":<redacted>,"x":1}'],
    ["a cookie header", "cookie: session=abc123; theme=dark", "cookie: <redacted>"],
    ["a custom key header", "x-api-key: zz-live-0123456789", "x-api-key: <redacted>"],
    ["a URL query secret", "GET https://api.example.com/v1?key=abcdef123456&alt=json", "GET https://api.example.com/v1?key=<redacted>&alt=json"],
    ["a database URL", "postgres://admin:hunter2@db.internal:5432/app", "postgres://<credentials>@db.internal:5432/app"],
    ["a bare provider key", "invalid key sk-ant-api03-abcdefghijklmnop0123 for request", "invalid key <redacted> for request"],
    ["a GitHub token", "remote: ghp_0123456789abcdefghijABCDEFGHIJ012345 denied", "remote: <redacted> denied"],
    ["a JSON Web Token", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123-_x rejected", "jwt <redacted> rejected"],
  ])("redacts %s", (_kind, input, expected) => {
    expect(redactDiagnosticText(input)).toBe(expected);
  });

  it.each([
    ["DB_PASSWORD=p@ss;w0rd! next", "DB_PASSWORD=<redacted> next"],
    ["OPENAI_API_KEY=abc,def-ghi next", "OPENAI_API_KEY=<redacted> next"],
    ["PROXY_PASSWORD=a]b}c next", "PROXY_PASSWORD=<redacted> next"],
    ["secret: it's)complicated&long next", "secret: <redacted> next"],
    ['run "password=hunter2" now', 'run "password=<redacted> now'],
    ['{"auth token": "abc"}', '{"auth token": "<redacted>"}'],
    ["env: API_KEY=abc", "env: API_KEY=<redacted>"],
  ])("redacts the whole value of %s", (input, expected) => {
    expect(redactDiagnosticText(input)).toBe(expected);
  });

  it("redacts a private key block even when it is cut off", () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactDiagnosticText(`loading\n${key}\ndone`)).toBe("loading\n<redacted private key>\ndone");
    expect(redactDiagnosticText("-----BEGIN RSA PRIVATE KEY-----\nMIIEow")).toBe("<redacted private key>");
  });

  it.each([
    "Unexpected token } in JSON at position 3",
    "input_tokens: 1200, output_tokens=64, max_tokens: 4096",
    "tokenCount: 1234 token_limit=8192 (tokens: 12)",
    "authorization failed for the request",
    "Timed out waiting for get_state response after 30000ms",
    "Pi process exited with code 1",
    "ENOENT: no such file or directory, open '/home/user/project/.secrets/readme.md'",
  ])("leaves ordinary diagnostics readable: %s", (text) => {
    expect(redactDiagnosticText(text)).toBe(text);
  });

  it("stays fast on long unbroken output", () => {
    const blob = `${"A1b2C3d4".repeat(25_000)} token=abc`;
    const started = performance.now();
    const redacted = redactDiagnosticText(blob);
    expect(performance.now() - started).toBeLessThan(500);
    expect(redacted.endsWith("token=<redacted>")).toBe(true);
  });

  it.each([
    ["dotted words", "a."],
    ["token-like words", "-token"],
    ["JWT-like prefixes", "eyJ-"],
    ["scheme-like words", "ab+"],
    ["assignment chains", "a="],
    ["quoted assignment chains", 'token"='],
    ["unclosed quotes", 'token="'],
    ["bearer words", "bearer "],
    ["key headers", "-----BEGIN "],
  ])("redacts 256 KiB of repeated %s in linear time", (_shape, unit) => {
    // Pi's stderr buffer is 64 KiB; this leaves a wide margin above it.
    const text = unit.repeat(Math.ceil(262_144 / unit.length));
    const started = performance.now();
    redactDiagnosticText(text);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("bounds a redacted error", () => {
    const text = redactError(new Error(`failed password=hunter2 ${"x".repeat(20_000)}`));
    expect(text).toHaveLength(12_000);
    expect(text).toContain("Error: failed password=<redacted>");
  });
});

describe("diagnosticErrorText", () => {
  it("drops the Pi stderr excerpt appended to an RPC failure", () => {
    const error = 'Pi process exited with code 1. Stderr: provider said {"content":"private prompt"}\nsecond line';
    expect(diagnosticErrorText(error)).toBe("Pi process exited with code 1 (Pi stderr omitted)");
  });

  it("keeps an ordinary error, redacted and bounded", () => {
    expect(diagnosticErrorText("Timed out waiting for prompt response after 30000ms"))
      .toBe("Timed out waiting for prompt response after 30000ms");
    expect(diagnosticErrorText("401 from https://user:pw@proxy.example/ with token=abc")).toBe(
      "401 from https://<credentials>@proxy.example/ with token=<redacted>",
    );
    expect(diagnosticErrorText("x".repeat(5_000))).toHaveLength(2_000);
  });
});
