/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import MarkdownHtml from "$ui/features/conversation/markdown/MarkdownHtml.svelte";
import { clientCapabilities } from "$ui/state/clientCapabilities.svelte";

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost: bridge.post }));

// VS Code's webview frame listens for clicks on the window and sends every
// anchor it finds to its own opener, whether or not the click was already
// handled. A click FrostPi handles must not reach that listener.
describe("MarkdownHtml link clicks", () => {
  // Like VS Code's own listener, it cancels the navigation it takes over.
  const windowClicks = vi.fn((event: Event) => event.preventDefault());

  beforeEach(() => {
    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    window.addEventListener("click", windowClicks);
  });

  afterEach(() => {
    window.removeEventListener("click", windowClicks);
    cleanup();
    windowClicks.mockClear();
    bridge.post.mockReset();
  });

  it("opens a web link once, without VS Code's frame also seeing the click", () => {
    const view = render(MarkdownHtml, { props: { content: "[site](https://example.com/docs)" } });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    view.container.querySelector("a")!.dispatchEvent(click);

    expect(bridge.post).toHaveBeenCalledTimes(1);
    expect(bridge.post).toHaveBeenCalledWith({ type: "openExternal", url: "https://example.com/docs" });
    expect(click.defaultPrevented).toBe(true);
    expect(windowClicks).not.toHaveBeenCalled();
  });

  it("opens a file link without VS Code's frame also seeing the click", () => {
    const view = render(MarkdownHtml, { props: { content: "[source](src/a.ts#L7)" } });
    view.container.querySelector("a[data-file-path]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(bridge.post).toHaveBeenCalledWith({ type: "openFile", path: "src/a.ts", line: 7 });
    expect(windowClicks).not.toHaveBeenCalled();
  });

  it("leaves links FrostPi does not open to the webview", () => {
    const view = render(MarkdownHtml, { props: { content: "[mail](mailto:someone@example.com)" } });
    view.container.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(bridge.post).not.toHaveBeenCalled();
    expect(windowClicks).toHaveBeenCalledTimes(1);
  });
});
