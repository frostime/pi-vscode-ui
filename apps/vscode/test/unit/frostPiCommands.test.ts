import { describe, expect, it } from "vitest";

import { withFrostPiCommands } from "$ui/features/composer/frostPiCommands.js";

describe("FrostPi composer commands", () => {
  it("defaults to common local commands and preserves Pi's editor command", () => {
    const commands = withFrostPiCommands([
      { name: "compact", description: "Extension compact", source: "extension" },
      { name: "resume", description: "Extension resume", source: "extension" },
      { name: "editor", description: "Pi editor", source: "extension" },
      { name: "inspect", description: "Inspect files", source: "prompt" },
    ]);

    expect(commands).toEqual([
      expect.objectContaining({ name: "compact", source: "frostpi" }),
      expect.objectContaining({ name: "resume", source: "frostpi" }),
      { name: "editor", description: "Pi editor", source: "extension" },
      expect.objectContaining({ name: "inspect", source: "prompt" }),
    ]);
  });

  it("does not advertise a client editor when Pi supplies none", () => {
    expect(withFrostPiCommands([]).map((command) => command.name)).toEqual(["compact", "resume"]);
  });

  it("replaces only names occupied by the supplied local command set", () => {
    const local = { name: "inspect", description: "Local inspect", source: "frostpi" };
    const compact = { name: "compact", description: "Pi compact", source: "extension" };
    const resume = { name: "resume", description: "Pi resume", source: "extension" };
    const editor = { name: "editor", description: "Pi editor", source: "extension" };
    const remote = [compact, resume, editor, { name: "inspect", source: "prompt" }];

    expect(withFrostPiCommands(remote, [local])).toEqual([local, compact, resume, editor]);
    expect(withFrostPiCommands(remote, [])).toEqual(remote);
  });
});
