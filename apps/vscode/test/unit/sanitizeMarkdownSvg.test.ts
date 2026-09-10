/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { sanitizeMarkdownSvg } from "../../src/webview/features/conversation/markdown/sanitizeMarkdownSvg.js";

describe("sanitizeMarkdownSvg", () => {
  it("keeps static SVG and local fragment references", () => {
    const result = sanitizeMarkdownSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
        <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>
        <rect width="120" height="80" fill="url(#g)"/>
      </svg>
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain("url(#g)");
    expect(result.removedUnsafeContent).toBe(false);
  });

  it("removes scripts, events, foreign content, and external resources with a warning", () => {
    const result = sanitizeMarkdownSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onclick="alert('root')">
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
        <image href="https://example.com/tracker.png" width="10" height="10"/>
        <rect width="100" height="100" onclick="alert(2)" style="fill:red"/>
      </svg>
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/script|foreignObject|onclick|https:|style=/i);
    expect(result.removedUnsafeContent).toBe(true);
  });

  it("fails closed for active-only, malformed, or oversized SVG", () => {
    expect(sanitizeMarkdownSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toEqual({ ok: false });
    expect(sanitizeMarkdownSvg("not svg")).toEqual({ ok: false });
    expect(sanitizeMarkdownSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 1"><rect width="1" height="1"/></svg>')).toEqual({ ok: false });
  });
});
