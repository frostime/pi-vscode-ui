# Contributing

Before opening a change, read `.dev/docs/architecture/overview.md`, `.dev/docs/development.md`, and the relevant adjacent `*.SPEC.md` contract.

Required local gate:

```bash
pnpm check
pnpm package:vsix
pnpm verify:vsix
```

Changes to RPC framing, session lifecycle, extension UI, persistence, or Host–Webview synchronization require behavior tests and an update to the corresponding SPEC. UI changes must preserve keyboard operation, visible focus, narrow-sidebar behavior, VS Code theme compatibility, and reduced-motion support.

Do not introduce a Pi tool proxy, global session execution lock, provider credential store, custom TUI emulator, or new persisted content without an explicit product decision and documentation update.
