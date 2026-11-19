import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";

import ExtensionUiRequestCard from "$ui/features/extension-ui/ExtensionUiRequestCard.svelte";

const bridge = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("$ui/bridge/hostBridge", () => ({ postToHost: bridge.post }));

afterEach(cleanup);

it("keeps multiline prompt details keyboard-accessible above the choices", () => {
  const details = "Working directory: /workspace\n  preserved indentation\nReason: complete explanation";
  const view = render(ExtensionUiRequestCard, {
    props: {
      sessionId: "session",
      request: { id: "prompt", method: "select", title: "Run this command?\n" + details, options: ["Allow", "Deny"], receivedAt: 0 },
    },
  });
  const region = view.getByRole("region", { name: "Prompt details" });
  expect(region.tabIndex).toBe(0);
  expect(within(region).getByText("Run this command?")).toBeTruthy();
  expect(region.querySelector("p")?.textContent).toBe(details);
  const choices = view.getByRole("group", { name: "Choices" });
  expect(region.contains(choices)).toBe(false);
  expect(choices.classList.contains("choice-list")).toBe(false);
  expect(within(choices).getByRole("button", { name: "Deny" })).toBeTruthy();
});

it("shows the recommendation and description separately while returning the exact option", async () => {
  const option = "1. Preview — internal (Recommended) — Share with the team.";
  const view = render(ExtensionUiRequestCard, {
    props: {
      sessionId: "session",
      request: {
        id: "prompt", method: "select", title: "[Deployment] Where should I deploy the preview?", receivedAt: 0,
        options: [option, "2. Local only — Keep it private.", "3. Type something."],
        questionSelect: {
          question: "Where should I deploy the preview?", header: "Deployment", details: "", customLabel: "Type something.",
          choices: [
            { label: "Preview — internal", description: "Share with the team.", recommended: true },
            { label: "Local only", description: "Keep it private.", recommended: false },
          ],
        },
      },
    },
  });
  const region = view.getByRole("region", { name: "Prompt details" });
  expect(within(region).getByText("Where should I deploy the preview?")).toBeTruthy();
  const choice = view.getByRole("button", { name: "Preview — internal Recommended" });
  expect(view.getByRole("group", { name: "Choices" }).classList.contains("choice-list")).toBe(true);
  expect(within(choice).getByText("Recommended")).toBeTruthy();
  expect(choice.getAttribute("aria-describedby")).toBe(within(choice).getByText("Share with the team.").id);
  expect(view.getByRole("group", { name: "Choices" }).contains(view.getByRole("button", { name: "Type something." }))).toBe(false);
  await fireEvent.click(choice);
  expect(bridge.post).toHaveBeenCalledExactlyOnceWith({
    type: "respondExtensionUi", sessionId: "session", requestId: "prompt", response: { value: option },
  });
});
