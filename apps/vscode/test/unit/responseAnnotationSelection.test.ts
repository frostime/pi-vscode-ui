/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { readSourceSelection } from "../../src/webview/features/annotation-review/annotationSelection.js";

describe("response source selection", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it("maps a selection across fragmented highlight nodes back to source offsets", () => {
    const root = document.createElement("div");
    const first = document.createTextNode("before ");
    const mark = document.createElement("span");
    const marked = document.createTextNode("selected");
    const last = document.createTextNode(" text after");
    mark.append(marked);
    root.append(first, mark, last);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(first, 6);
    range.setEnd(last, 5);
    const selection = window.getSelection();
    selection?.addRange(range);

    expect(readSourceSelection(root, "before selected text after", selection)).toEqual({ start: 7, end: 20 });
  });

  it("rejects selections that leave the frozen source", () => {
    const root = document.createElement("div");
    const inside = document.createTextNode("inside");
    const outside = document.createTextNode("outside");
    root.append(inside);
    document.body.append(root, outside);

    const range = document.createRange();
    range.setStart(inside, 0);
    range.setEnd(outside, 3);
    const selection = window.getSelection();
    selection?.addRange(range);

    expect(readSourceSelection(root, "inside", selection)).toBeNull();
  });
});
