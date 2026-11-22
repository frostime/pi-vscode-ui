import { describe, expect, it } from "vitest";

import { configuredLaunchArguments } from "../../src/core/configuration/resumeLaunchArguments.js";

describe("configured Pi arguments for a launch", () => {
  const args = ["--provider", "deepseek", "--model", "deepseek-flash", "--thinking", "high", "--models", "deepseek/*", "--verbose"];

  it("keeps the model choice for a new conversation", () => {
    expect(configuredLaunchArguments(args, false, "pi")).toEqual(args);
  });

  it("drops it when Pi resumes a saved session, which restores its own model", () => {
    expect(configuredLaunchArguments(args, true, "pi")).toEqual(["--models", "deepseek/*", "--verbose"]);
    // A trailing flag without a value is Pi's to reject, not ours to reinterpret.
    expect(configuredLaunchArguments(["--model"], true, "pi")).toEqual(["--model"]);
  });

  it("leaves another runtime's arguments alone", () => {
    expect(configuredLaunchArguments(args, true, "oh-my-pi")).toEqual(args);
  });
});
