import { describe, expect, it, vi } from "vitest";

import { createId } from "$ui/utils/createId.js";

describe("createId", () => {
  it("returns a non-empty identifier without assuming crypto.randomUUID exists", () => {
    const first = createId("test");
    const second = createId("test");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("uses crypto.randomUUID when available", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
    expect(createId()).toBe("00000000-0000-4000-8000-000000000000");
    randomUUID.mockRestore();
  });
});
