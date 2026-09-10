/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { sanitizeMarkdownSvg } from "../../src/webview/features/conversation/markdown/sanitizeMarkdownSvg.js";

describe("sanitizeMarkdownSvg", () => {
  it("keeps ordinary SVG content and styles unchanged", () => {
    const result = sanitizeMarkdownSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
        <style>.box { fill: red; }</style>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">content</div></foreignObject>
        <rect class="box" width="120" height="80"/>
        <image href="https://example.com/image.png" width="10" height="10"/>
      </svg>
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain("foreignObject");
    expect(result.svg).toContain("https://example.com/image.png");
    expect(result.removedScripts).toBe(false);
  });

  it("gives viewBox-only SVGs intrinsic dimensions for shrink-to-fit layout", () => {
    const result = sanitizeMarkdownSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 660"><rect width="1200" height="660"/></svg>');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).toContain('width="1200"');
    expect(result.svg).toContain('height="660"');
  });

  it("removes script elements and reports the change", () => {
    const result = sanitizeMarkdownSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert(1)</script>
        <g><script type="application/ecmascript">alert(2)</script></g>
        <rect width="10" height="10"/>
      </svg>
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.svg).not.toMatch(/<script/i);
    expect(result.svg).toContain("<rect");
    expect(result.removedScripts).toBe(true);
  });

  it("accepts common SVG entities for Blob-image decoding", () => {
    const result = sanitizeMarkdownSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>a&nbsp;b</text><rect width="2" height="2"/></svg>');
    expect(result.ok).toBe(true);
  });

  it("fails closed when the source has no SVG root", () => {
    expect(sanitizeMarkdownSvg("not svg")).toEqual({ ok: false });
  });
});
