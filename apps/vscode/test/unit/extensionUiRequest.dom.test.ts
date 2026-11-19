import { cleanup, render, within } from "@testing-library/svelte";
import { afterEach, expect, it } from "vitest";

import ExtensionUiRequestCard from "$ui/features/extension-ui/ExtensionUiRequestCard.svelte";

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
  expect(within(choices).getByRole("button", { name: "Deny" })).toBeTruthy();
});
