import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectHostBridge } from "$ui/bridge/hostBridge";
import OnboardingView from "$ui/features/onboarding/OnboardingView.svelte";

const postMessage = vi.fn();
let disconnectHost: () => void;

beforeEach(() => {
  postMessage.mockClear();
  disconnectHost = connectHostBridge({ postMessage, onMessage: () => () => undefined });
});

afterEach(() => {
  cleanup();
  disconnectHost();
});

function posted(): unknown[] {
  return postMessage.mock.calls.map(([message]) => Object.fromEntries(
    Object.entries(message as Record<string, unknown>).filter(([key]) => key !== "bridgeVersion"),
  ));
}

describe("start page without a Session", () => {
  it("starts a saved or a temporary Session in the sidebar, or resumes one", async () => {
    const view = render(OnboardingView);
    const names = view.getAllByRole("button").map((button) => button.textContent?.trim() ?? "");
    expect(names).toEqual(["New session", "Temporary session", "Resume session"]);

    for (const name of names) await fireEvent.click(view.getByRole("button", { name }));
    expect(posted()).toEqual([
      { type: "createSession" },
      { type: "createSession", ephemeral: true },
      { type: "resumeSession" },
    ]);
  });
});
