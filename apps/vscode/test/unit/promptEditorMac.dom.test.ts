import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";
import PromptEditor from "$ui/features/composer/PromptEditor.svelte";

// CodeMirror resolves Mod to Cmd on macOS when its keymap module loads.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
});

afterEach(() => cleanup());

it.each([false, true])("keeps Cmd+Enter sending on macOS (sendOnEnter=%s)", async (sendOnEnter) => {
  const submit = vi.fn();
  const view = render(PromptEditor, {
    sessionId: "session", value: "Send this prompt", commands: [], placeholder: "Message Pi",
    sendOnEnter, currentStreamingBehavior: "steer", onchange: vi.fn(), onsubmit: submit, onpasteimages: vi.fn(),
  });
  await fireEvent.keyDown(view.getByRole("textbox", { name: "Message Pi" }), { key: "Enter", metaKey: true });
  expect(submit).toHaveBeenCalledExactlyOnceWith("steer");
});
