import { describe, expect, it } from "vitest";

import { normalizePiSlashPrompt } from "../../src/core/sessions/normalizePiSlashPrompt.js";

describe("normalizePiSlashPrompt", () => {
  it("leaves ordinary prompts and bare commands unchanged", () => {
    expect(normalizePiSlashPrompt("hello")).toBe("hello");
    expect(normalizePiSlashPrompt("  /toggle-web-proxy  ")).toBe("/toggle-web-proxy");
    expect(normalizePiSlashPrompt("/toggle-web-proxy status")).toBe("/toggle-web-proxy status");
  });

  it("rewrites Unicode whitespace after the command token to a single ASCII space", () => {
    expect(normalizePiSlashPrompt("/toggle-web-proxy\u00a0status")).toBe("/toggle-web-proxy status");
    expect(normalizePiSlashPrompt("/toggle-web-proxy\u3000status")).toBe("/toggle-web-proxy status");
    expect(normalizePiSlashPrompt("/toggle-web-proxy\tstatus")).toBe("/toggle-web-proxy status");
    expect(normalizePiSlashPrompt("  /toggle-web-proxy\u00a0\u00a0status\nmore  ")).toBe("/toggle-web-proxy status\nmore");
  });

  it("does not rewrite whitespace that is not a leading slash command", () => {
    expect(normalizePiSlashPrompt("see /toggle-web-proxy\u00a0status")).toBe("see /toggle-web-proxy\u00a0status");
  });
});
