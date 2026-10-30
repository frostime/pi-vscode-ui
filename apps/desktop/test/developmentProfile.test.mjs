import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { developmentLaunchEnvironment } from "../scripts/development-profile.mjs";

describe("Desktop development profile", () => {
  it("isolates FrostPi storage without changing Pi data, launch configuration or the parent environment", () => {
    const environment = {
      APPDATA: "user-app-data", PATH: "existing-path", PI_CODING_AGENT_DIR: "existing-agent",
      PI_CODING_AGENT_SESSION_DIR: "existing-sessions", OTHER_SETTING: "preserved",
    };
    expect(developmentLaunchEnvironment(environment)).toEqual({
      ...environment, FROSTPI_DESKTOP_USER_DATA: join("user-app-data", "FrostPi-Dev"),
    });
    expect(environment).not.toHaveProperty("FROSTPI_DESKTOP_USER_DATA");
    expect(developmentLaunchEnvironment({ APPDATA: "user-app-data" })).not.toHaveProperty("PI_CODING_AGENT_DIR");
    expect(developmentLaunchEnvironment({ APPDATA: "user-app-data" })).not.toHaveProperty("PI_CODING_AGENT_SESSION_DIR");
  });

  it("honors an explicit FrostPi profile without requiring APPDATA", () => {
    expect(developmentLaunchEnvironment({ FROSTPI_DESKTOP_USER_DATA: "custom-profile" })).toEqual({ FROSTPI_DESKTOP_USER_DATA: "custom-profile" });
  });

  it("does not silently fall back to the working directory when no profile can be resolved", () => {
    expect(() => developmentLaunchEnvironment({})).toThrow("APPDATA or FROSTPI_DESKTOP_USER_DATA");
  });
});
