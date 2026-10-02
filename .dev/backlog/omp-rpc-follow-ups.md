---
created: 2026-10-02
status: open
origin: omp-rpc-dialect
---

# OMP RPC Follow-ups

These capabilities are intentionally disabled in the initial OMP integration. They remain planned compatibility work and must be implemented behind the RPC-dialect and runtime-contract boundaries.

- Slash commands: translate `get_available_commands` / `available_commands_update`, classify command sources, then expose only commands whose execution semantics are understood.
- Session tree and fork: compare OMP `branch` with FrostPi fork/tree commit, identity, abort, and history contracts before mapping it to Pi vocabulary.
- Prompt result lifecycle: evaluate `prompt_result` as request-correlated completion without confusing it with session-wide `session_settled`.
- Retry semantics: map OMP `isTerminal`, `yielded`, `awaitingAsyncWork`, and `auto_retry_*` to FrostPi's retry contract only after a verified state mapping.
- Runtime ask UI: add the separate `rpc-ui` / `set_ask_dialog` path if FrostPi intentionally supports OMP's built-in ask tool. This is distinct from the enabled FrostPi Question tool.
- v1 truncation diagnostics: define an observational marker for OMP event shrinking on the supported v1 transport path. It must not drive session state.
