import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import PanelShell from "$ui/shell/PanelShell.svelte";

describe("Session presentation shells", () => {
  it("marks a failed panel as a one-row restricted shell", () => {
    const { body } = render(PanelShell, {
      props: { session: { status: "failed", error: "Pi stopped" } as never, localCommands: { completions: (commands: never[]) => commands, handle: () => undefined } },
    });

    expect(body).toContain("app-shell panel-shell panel-failed");
    expect(body).toContain("panel-failure");
    expect(body).toContain("Pi stopped");
    expect(body).not.toContain("<button");
  });
});
