# Thinking-level compatibility

- Pi's active model metadata is authoritative; FrostPi does not invent provider-specific levels.
- Non-reasoning models expose only disabled `off`.
- Reasoning models default to `off`, `minimal`, `low`, `medium`, and `high`.
- A level mapped to `null` is hidden; `xhigh` and `max` require explicit non-null advertisement.
- If Pi clamps a selection, the next `get_state` result wins.
