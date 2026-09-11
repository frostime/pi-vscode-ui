import { describe, expect, it, vi } from "vitest";

import { parseFdVersion, selectFdExecutable } from "../../src/extension/fd/fdExecutable.js";

describe("fd executable selection", () => {
  it("prefers a modern managed fd over an older PATH fd", async () => {
    const oldFd = parseFdVersion("fd", "fd 9.0.0");
    const managedFd = parseFdVersion("/pi/bin/fd", "fd 10.2.0");
    const probe = vi.fn((command: string) => Promise.resolve(command === "fd" ? oldFd : managedFd));

    await expect(selectFdExecutable(["fd", "/pi/bin/fd"], probe)).resolves.toEqual(managedFd);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("treats fd 10+ as supporting directory markers", () => {
    expect(parseFdVersion("fd", "fd 10.2.0").supportsDirectoryMarkers).toBe(true);
    expect(parseFdVersion("fd", "fd 9.0.0").supportsDirectoryMarkers).toBe(false);
  });
});
