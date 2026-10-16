---
title: Data and Privacy Model
description: Engineering inventory of stored, transported, secret, and diagnostic data.
scope:
  - /apps/vscode/src/extension/**
  - /apps/vscode/src/webview/**
updated: 2026-07-16
---

# Data and Privacy Model

| Data | Location | Lifetime |
|---|---|---|
| Session id/title/cwd/Pi session path | VS Code workspace state | Until session closure/state removal |
| Conversation/history | Pi process and Pi session file | Controlled by Pi |
| Composer text/images | Webview memory | Until sent/cleared/Webview loss |
| `@file` candidates | Extension Host memory | Cached briefly; file content is not read |
| Proxy credentials | VS Code SecretStorage | Until cleared by user |
| Provider Usage credentials | Extension Host/package memory; read from Pi configuration/environment | Query-local, never bridged or persisted |
| Provider Usage snapshots | Webview memory, cached by provider | Until refresh or metrics component/Webview disposal |
| Diagnostics | Output channel or user-selected file | User controlled |

FrostPi has no telemetry endpoint. Proxy URLs from settings may be placed in the Pi child environment; stored authentication is kept separately in SecretStorage. Diagnostic text is redacted for common secrets and URL credentials, but users should still review paths and third-party stderr before sharing.
