import { describe, expect, it } from "vitest";

import { INITIAL_SCROLL_FOLLOW_STATE, reduceScrollFollow } from "../../src/webview/features/conversation/scrolling/scrollFollowState.js";

describe("scroll follow state", () => {
  it("pauses on user scroll and counts updates without moving", () => {
    const paused = reduceScrollFollow(INITIAL_SCROLL_FOLLOW_STATE, { type: "userScroll", distanceFromBottom: 300, threshold: 64, programmatic: false });
    expect(paused.mode).toBe("paused");
    expect(reduceScrollFollow(paused, { type: "contentUpdate", newTurn: false })).toEqual({ mode: "paused", unseenUpdates: 1 });
  });

  it("resumes at the bottom and follows a newly submitted turn", () => {
    const paused = { mode: "paused" as const, unseenUpdates: 12 };
    expect(reduceScrollFollow(paused, { type: "userScroll", distanceFromBottom: 10, threshold: 64, programmatic: false })).toEqual(INITIAL_SCROLL_FOLLOW_STATE);
    expect(reduceScrollFollow(paused, { type: "contentUpdate", newTurn: true })).toEqual(INITIAL_SCROLL_FOLLOW_STATE);
  });
});
