import { afterEach, describe, expect, it, vi } from "vitest";

import { createId } from "$ui/utils/createId.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("createId", () => {
  it("falls back to a prefixed unique identifier when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});

    const first = createId("test");
    const second = createId("test");

    expect(first.startsWith("test-")).toBe(true);
    expect(first).not.toBe(second);
  });
});
