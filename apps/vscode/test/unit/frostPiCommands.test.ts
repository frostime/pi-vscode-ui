import { describe, expect, it } from "vitest";

import { withFrostPiCommands } from "../../src/webview/features/composer/frostPiCommands.js";

describe("FrostPi composer commands", () => {
  it("advertises built-in commands ahead of same-named Pi resources", () => {
    const commands = withFrostPiCommands([
      { name: "compact", description: "Extension compact", source: "extension" },
      { name: "inspect", description: "Inspect files", source: "prompt" },
    ]);

    expect(commands).toEqual([
      expect.objectContaining({ name: "compact", source: "frostpi" }),
      expect.objectContaining({ name: "editor", source: "frostpi" }),
      expect.objectContaining({ name: "resume", source: "frostpi" }),
      expect.objectContaining({ name: "inspect", source: "prompt" }),
    ]);
  });

  it("omits host-local Resume from Session Tab completion", () => {
    const commands = withFrostPiCommands([
      { name: "resume", description: "Extension resume", source: "extension" },
      { name: "inspect", description: "Inspect files", source: "prompt" },
    ], false);

    expect(commands.map((command) => command.name)).toEqual(["compact", "editor", "inspect"]);
  });
});
