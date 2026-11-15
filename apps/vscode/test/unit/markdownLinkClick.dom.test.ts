/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import {
  FILE_LINK_SECTION,
  LINK_TARGET_KEY,
  linkTargetFromContext,
  WEB_LINK_SECTION,
} from "$shared/model/linkContextMenu";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import MarkdownHtml from "$ui/features/conversation/markdown/MarkdownHtml.svelte";
import { clientCapabilities } from "$ui/state/clientCapabilities.svelte";
import { EMPTY_PRESENTATION, presentationStore } from "$ui/state/sessionViewStore.svelte";

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

// VS Code's frame opens its webview context menu from a window listener and
// passes the closest `data-vscode-context` (merged with its ancestors') to the
// menu's `when` clauses and to the chosen command.
describe("MarkdownHtml link context menu", () => {
  let menuContext: Record<string, unknown> | undefined;
  const windowMenus = (event: MouseEvent): void => {
    let context: Record<string, unknown> = {};
    let element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-vscode-context]") : null;
    while (element) {
      context = { ...JSON.parse(element.dataset["vscodeContext"]!) as Record<string, unknown>, ...context };
      element = element.parentElement?.closest<HTMLElement>("[data-vscode-context]") ?? null;
    }
    menuContext = context;
  };
  const rightClick = (element: Element): void => {
    element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  };

  beforeEach(() => {
    menuContext = undefined;
    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    presentationStore.set({ ...EMPTY_PRESENTATION, displayedSession: { cwd: "/repo" } as SessionViewModel });
    window.addEventListener("contextmenu", windowMenus);
  });

  afterEach(() => {
    window.removeEventListener("contextmenu", windowMenus);
    cleanup();
  });

  it("offers a web link's address to Copy Link Address", () => {
    const view = render(MarkdownHtml, { props: { content: "See [the **docs**](https://example.com/docs)." } });
    rightClick(view.container.querySelector("strong")!);

    expect(menuContext).toEqual({ webviewSection: WEB_LINK_SECTION, [LINK_TARGET_KEY]: "https://example.com/docs" });
    expect(linkTargetFromContext(menuContext, WEB_LINK_SECTION)).toBe("https://example.com/docs");
    expect(linkTargetFromContext(menuContext, FILE_LINK_SECTION)).toBeUndefined();
  });

  it("offers a file link's resolved path to Copy Path, following the displayed session", () => {
    const view = render(MarkdownHtml, { props: { content: "[source](src/a.ts#L7)" } });
    const link = view.container.querySelector("a[data-file-path]")!;
    rightClick(link);
    expect(menuContext).toEqual({ webviewSection: FILE_LINK_SECTION, [LINK_TARGET_KEY]: "/repo/src/a.ts:7" });

    presentationStore.set({ ...EMPTY_PRESENTATION, displayedSession: { cwd: "/other" } as SessionViewModel });
    rightClick(link);
    expect(linkTargetFromContext(menuContext, FILE_LINK_SECTION)).toBe("/other/src/a.ts:7");
  });

  it("offers nothing for text outside links or for links the product cannot open", () => {
    const view = render(MarkdownHtml, { props: { content: "Plain [source](src/a.ts) text" } });
    rightClick(view.container.querySelector("p")!);
    expect(menuContext).toEqual({});

    const link = view.container.querySelector("a[data-file-path]")!;
    rightClick(link);
    expect(linkTargetFromContext(menuContext, FILE_LINK_SECTION)).toBe("/repo/src/a.ts");
    clientCapabilities.set({ ...VSCODE_CLIENT_UI_CAPABILITIES, openReferencedLocation: false });
    rightClick(link);
    expect(menuContext).toEqual({});
  });

  it("rejects a command argument that is not a FrostPi link", () => {
    expect(linkTargetFromContext(undefined, WEB_LINK_SECTION)).toBeUndefined();
    expect(linkTargetFromContext({ webviewSection: WEB_LINK_SECTION, [LINK_TARGET_KEY]: 7 }, WEB_LINK_SECTION)).toBeUndefined();
    expect(linkTargetFromContext({ webviewSection: WEB_LINK_SECTION, [LINK_TARGET_KEY]: "" }, WEB_LINK_SECTION)).toBeUndefined();
  });

});
