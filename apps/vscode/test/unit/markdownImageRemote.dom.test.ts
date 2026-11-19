import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownHtml from "$ui/features/conversation/markdown/MarkdownHtml.svelte";

const postToHost = vi.hoisted(() => vi.fn());
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost }));

afterEach(() => {
  cleanup();
  postToHost.mockClear();
});

describe("Markdown image references", () => {
  it("shows a remote image without a fetch action or live image source", async () => {
    const { container, rerender } = render(MarkdownHtml, {
      content: "![Chart](https://images.example.com",
    });
    await rerender({ content: "![Chart](https://images.example.com/chart.png?mode=guide)" });
    expect(container.textContent).toContain("Remote image blocked · images.example.com");
    expect(container.querySelector("img, a[href], button")).toBeNull();
    expect(postToHost).not.toHaveBeenCalled();
  });

  it("keeps a local path inert when opening a message from history", () => {
    const { container } = render(MarkdownHtml, { content: "![Chart](./chart.png)" });
    expect(container.textContent).toContain("Ask Pi to read this image");
    expect(container.querySelector("img, a[href], button")).toBeNull();
    expect(postToHost).not.toHaveBeenCalled();
  });
});
