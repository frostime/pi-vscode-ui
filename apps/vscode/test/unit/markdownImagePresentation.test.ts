import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import ImageLightbox from "../../src/webview/features/conversation/ImageLightbox.svelte";
import MarkdownImage from "../../src/webview/features/conversation/markdown/MarkdownImage.svelte";

describe("Markdown image presentation", () => {
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
