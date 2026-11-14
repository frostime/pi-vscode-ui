/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VSCODE_CLIENT_UI_CAPABILITIES } from "$shared/model/clientUiCapabilities";
import type { SessionViewModel } from "$shared/model/sessionViewModel";
import MarkdownHtml from "$ui/features/conversation/markdown/MarkdownHtml.svelte";
import { clientCapabilities } from "$ui/state/clientCapabilities.svelte";
import { EMPTY_PRESENTATION, presentationStore } from "$ui/state/sessionViewStore.svelte";

describe("MarkdownHtml link preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clientCapabilities.set(VSCODE_CLIENT_UI_CAPABILITIES);
    presentationStore.set({
      ...EMPTY_PRESENTATION,
      displayedSession: { cwd: "C:\\repo" } as SessionViewModel,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reveals the target of the link under the pointer", async () => {
    const view = render(MarkdownHtml, {
      props: { content: "[source](src/a.ts#L7) and [site](https://example.com/docs)" },
    });

    const fileLink = view.container.querySelector<HTMLAnchorElement>("a[data-file-path]");
    expect(fileLink).not.toBeNull();
    await fireEvent.pointerOver(fileLink!);
    vi.advanceTimersByTime(999);
    expect(preview()?.dataset["visible"] ?? "false").toBe("false");

    vi.advanceTimersByTime(1);
    expect(preview()?.textContent).toBe("C:\\repo\\src\\a.ts:7");
    expect(preview()?.dataset["visible"]).toBe("true");

    await fireEvent.pointerOut(fileLink!, { relatedTarget: document.body });
    const siteLink = view.container.querySelector<HTMLAnchorElement>("a[href^='https://']");
    await fireEvent.pointerOver(siteLink!);
    vi.advanceTimersByTime(1_000);
    expect(preview()?.textContent).toBe("https://example.com/docs");
  });

  it("retires visible and pending previews when streaming replaces the link markup", async () => {
    const view = render(MarkdownHtml, { props: { content: "[old](https://example.com/old)" } });
    await fireEvent.pointerOver(view.container.querySelector("a")!);
    vi.advanceTimersByTime(1_000);
    expect(preview()?.dataset["visible"]).toBe("true");
    await view.rerender({ content: "[new](https://example.com/new)" });
    expect(preview()?.dataset["visible"] ?? "false").toBe("false");

    await fireEvent.pointerOver(view.container.querySelector("a")!);
    await view.rerender({ content: "No link left." });
    vi.advanceTimersByTime(1_000);
    expect(preview()?.dataset["visible"] ?? "false").toBe("false");
  });

  it("keeps one global listener pair and the shared preview until the last message unmounts", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const first = render(MarkdownHtml, { props: { content: "[first](https://example.com/first)" } });
    const second = render(MarkdownHtml, { props: { content: "[second](https://example.com/second)" } });
    for (const type of ["scroll", "resize"]) {
      expect(added.mock.calls.filter(([event]) => event === type)).toHaveLength(1);
    }
    const link = second.container.querySelector("a")!;
    await fireEvent.focusIn(link);
    expect(preview()?.dataset["visible"]).toBe("true");
    first.unmount();
    expect(preview()?.dataset["visible"]).toBe("true");
    await fireEvent.scroll(window);
    expect(preview()?.dataset["visible"]).toBe("false");
    await fireEvent.focusIn(link);
    await fireEvent.resize(window);
    expect(preview()?.dataset["visible"]).toBe("false");
    second.unmount();
    expect(preview()).toBeNull();
    for (const type of ["scroll", "resize"]) {
      expect(removed.mock.calls.filter(([event]) => event === type)).toHaveLength(1);
    }
  });

  it("retires a pending preview when the pointer leaves early", async () => {
    const view = render(MarkdownHtml, { props: { content: "[source](src/a.ts#L7)" } });
    const link = view.container.querySelector<HTMLAnchorElement>("a[data-file-path]");

    await fireEvent.pointerOver(link!);
    await fireEvent.pointerOut(link!, { relatedTarget: document.body });
    vi.advanceTimersByTime(2_000);
    expect(preview()?.dataset["visible"] ?? "false").toBe("false");
  });
});

function preview(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".link-preview");
}
