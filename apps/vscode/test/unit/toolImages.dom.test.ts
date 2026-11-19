import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";

import type { AgentTurnView } from "@frostime/pi-client/shared/model/conversationModel";
import type { SessionViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import AgentTurn from "$ui/features/conversation/AgentTurn.svelte";

afterEach(cleanup);

it("opens a tool image from a completed, collapsed trace and returns to its thumbnail", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  const turn: AgentTurnView = {
    type: "turn", id: "turn-1", startedAt: 1, status: "completed", items: [
      { type: "reasoning", id: "thinking", timestamp: 1, text: "Inspecting the page", status: "complete" },
      { type: "tool", id: "step", timestamp: 2, tool: {
        state: "bound", id: "call", name: "browser", label: "browser", args: {}, startedAt: 2, status: "complete", isError: false,
        images: [{ id: "call-image-1", name: "Image 1", mimeType: "image/png", dataUrl, size: 8 }],
      } },
      { type: "response", id: "reply", timestamp: 3, status: "complete", blocks: [{ type: "text", text: "Done" }] },
    ],
  };
  const view = render(AgentTurn, { turn, session: { collapseTurnTrace: true } as SessionViewModel });
  expect(view.getByRole("button", { name: /Expand work trace:/ }).getAttribute("aria-expanded")).toBe("false");
  const thumbnail = view.getByRole("button", { name: "Open Image 1" });
  expect(thumbnail.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
  thumbnail.focus();
  await fireEvent.click(thumbnail);
  expect(view.getByRole("dialog", { name: "Image 1" }).querySelector("img")?.getAttribute("src")).toBe(dataUrl);
  await fireEvent.keyDown(window, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(thumbnail);
});
