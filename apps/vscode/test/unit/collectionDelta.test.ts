import { describe, expect, it } from "vitest";

import { collectionDelta } from "../../src/extension/webview-host/collectionDelta.js";
import { mergeCollection } from "../../src/webview/bridge/applyHostMessage.js";

describe("incremental Webview collections", () => {
  it("transmits only appended or replaced objects while preserving order", () => {
    const first = { id: "a", value: 1 };
    const changed = { id: "a", value: 2 };
    const appended = { id: "b", value: 3 };
    const delta = collectionDelta(["a"], new Map([["a", first]]), [changed, appended]);
    expect(delta).toEqual({ mode: "upsert", items: [changed, appended] });
    expect(mergeCollection([first], delta)).toEqual([changed, appended]);
  });

  it("replaces the collection when items are removed or reordered", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    expect(collectionDelta(["a", "b"], new Map([["a", a], ["b", b]]), [b, a])).toEqual({ mode: "replace", items: [b, a] });
  });
});
