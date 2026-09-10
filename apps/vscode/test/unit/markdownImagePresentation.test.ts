import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import ImageLightbox from "../../src/webview/features/conversation/ImageLightbox.svelte";
import MarkdownImage from "../../src/webview/features/conversation/markdown/MarkdownImage.svelte";
import { markdownImageCaption } from "../../src/webview/features/conversation/markdown/markdownImageCaption.js";

describe("Markdown image presentation", () => {
  it("prefers an explicit title and falls back to concise alt text", () => {
    expect(markdownImageCaption("操作入口", "页面截图")).toBe("操作入口");
    expect(markdownImageCaption(undefined, "操作入口")).toBe("操作入口");
    expect(markdownImageCaption("  ", "  页面截图  ")).toBe("页面截图");
    expect(markdownImageCaption(undefined, "x".repeat(161))).toBeUndefined();
  });

  it("keeps HTTPS sources inert behind an explicit load action", () => {
    const { body } = render(MarkdownImage, {
      props: {
        source: "https://images.example.com/diagram.png",
        alt: "Architecture diagram",
        title: "Architecture",
        linked: false,
      },
    });

    expect(body).toContain("Load image");
    expect(body).toContain("images.example.com");
    expect(body).not.toContain("<img");
    expect(body).not.toContain('src="https://images.example.com/diagram.png"');
  });

  it("renders an accessible bounded Lightbox with its title", () => {
    const { body } = render(ImageLightbox, {
      props: {
        src: "data:image/png;base64,AA==",
        alt: "Build result",
        title: "Build result overview",
        onclose() {},
      },
    });

    expect(body).toContain('role="dialog"');
    expect(body).toContain('aria-modal="true"');
    expect(body).toContain("Build result overview");
    expect(body).toContain('alt="Build result"');
  });
});
