import { describe, expect, it } from "vitest";

import { redactDiagnosticText } from "../../src/core/diagnostics/diagnosticRedaction.js";

describe("diagnostic redaction", () => {
  it("removes environment and URL credentials", () => {
    const redacted = redactDiagnosticText("API_TOKEN=abc https://alice:secret@proxy.example Bearer xyz.123");
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("alice");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("xyz.123");
    expect(redacted).toContain("<redacted>");
  });
});
