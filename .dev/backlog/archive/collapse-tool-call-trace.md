---
created: 2026-07-20
status: done
branch: feat/collapse-turn-trace
feasibility-study: conducted
---

# Collapse completed turn traces

## Goal

After a turn completes, hide intermediate work (tools, reasoning, interim assistant replies) behind one summary row so the timeline shows the final reply by default—Codex-style.

## Semantics (accepted)

- Setting: `frostpi.conversation.collapseTurnTrace` (boolean, default `true`, resource scope).
- Only `turn.status === "completed"` auto-collapses; running stays step-by-step; aborted/error stay flat.
- Collapse target: every activity **before the last `response`** (tools, reasoning, interim responses, notices in that prefix).
- Final response (and anything after it) stays visible.
- Summary label: `N steps · [E errors ·] duration` using whole-turn `endedAt - startedAt`.
- User expand is Webview-local per turn instance; new turns do not inherit; reload resets.
- Single-row tool/reasoning disclosure rules unchanged inside the expanded summary.

## Out of scope

- Persisting expand state across reload.
- Auto-collapse on aborted/error.
- Host-side rewriting of `activities` / Pi history.
