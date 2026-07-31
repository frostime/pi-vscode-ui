export interface ScrollFollowState {
  mode: "following" | "paused";
  unseenUpdates: number;
}

export type ScrollFollowEvent =
  | { type: "userScroll"; distanceFromBottom: number; threshold: number; programmatic: boolean }
  | { type: "contentUpdate"; newTurn: boolean }
  | { type: "resume" }
  | { type: "sessionChanged" };

export const INITIAL_SCROLL_FOLLOW_STATE: ScrollFollowState = { mode: "following", unseenUpdates: 0 };

export function reduceScrollFollow(state: ScrollFollowState, event: ScrollFollowEvent): ScrollFollowState {
  switch (event.type) {
    case "sessionChanged":
    case "resume":
      return INITIAL_SCROLL_FOLLOW_STATE;
    case "userScroll":
      if (event.distanceFromBottom < event.threshold) return INITIAL_SCROLL_FOLLOW_STATE;
      return event.programmatic ? state : { ...state, mode: "paused" };
    case "contentUpdate":
      if (event.newTurn || state.mode === "following") return INITIAL_SCROLL_FOLLOW_STATE;
      return { mode: "paused", unseenUpdates: Math.min(state.unseenUpdates + 1, 999) };
  }
}
