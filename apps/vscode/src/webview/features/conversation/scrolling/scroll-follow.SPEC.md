# Scroll follow

The conversation has two states: `following` and `paused`.

- Initial load, session switch, a newly submitted user turn, and explicit jump-to-latest enter `following`.
- User scrolling more than 64px from the bottom enters `paused`.
- While paused, Pi updates never change the viewport; a floating button counts update batches.
- Reaching the bottom manually or pressing the button resumes following.
- Expanding activities does not override the user's paused state.
- ResizeObserver follows content growth only while following.
