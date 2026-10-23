import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { startupDirectories } from "../src/main/startupArguments.js";

describe("Desktop startup directories", () => {
  it("skips the application path and the electron launcher in development", () => {
    assert.deepEqual(startupDirectories(["electron.exe", ".", "C:/work/project"], true), ["C:/work/project"]);
  });

  it("treats the first packaged argument as a directory", () => {
    assert.deepEqual(startupDirectories(["C:/apps/FrostPi/FrostPi.exe", "C:/work/a b"], false), ["C:/work/a b"]);
  });

  it("keeps directory order and drops command line switches", () => {
    const argv = ["FrostPi.exe", "C:/work/a", "--remote-debugging-port=0", "C:/work/b"];
    assert.deepEqual(startupDirectories(argv, false), ["C:/work/a", "C:/work/b"]);
  });

  it("starts without directories when launched from the desktop", () => {
    assert.deepEqual(startupDirectories(["C:/apps/FrostPi/FrostPi.exe"], false), []);
  });
});
