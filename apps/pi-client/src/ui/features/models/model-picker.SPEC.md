# Model picker

- `availableModels` remains the complete model catalogue returned by Pi.
- `scopedModelIds` is a Host-computed, read-only projection of Pi's `--models`/`enabledModels` scope. It contains canonical `provider/modelId` keys that also exist in `availableModels`.
- When `scopedModelIds` is non-empty, opening the picker starts in `Scoped`; otherwise it starts in `All`.
- `Scoped` and `All` change presentation only. The picker never writes `enabledModels`, changes Pi's model scope, or adds a new RPC command.
- Search and provider disclosure operate on the currently selected view. Selecting a model continues to use the existing `setModel` bridge action.
- Refreshing models recomputes both the full catalogue and the Host-computed scope. If scope configuration is missing, unreadable, invalid, or matches no available models, the picker fails open to `All`.
- The browser Tab key remains normal focus navigation; the visible scope control is the authoritative accessible way to switch views.
