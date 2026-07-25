---
title: Runtime and Trust Boundaries
description: Execution location, trust, persistence, proxy, secret handling, and failure isolation.
scope:
  - /apps/vscode/src/extension/**
updated: 2026-07-21
---

# Runtime and Trust Boundaries

FrostPi is a workspace extension. Local workspaces launch Pi locally; Remote SSH, WSL, and Dev Containers launch Pi in the remote Extension Host. No local-to-remote command bridge exists. A Session may run in the current workspace folder or an existing worktree of the same Git repository; the Extension Host discovers and validates that boundary before process start. Arbitrary external directories remain outside the workspace trust boundary.

Untrusted and virtual workspaces are unsupported because Pi can execute commands and modify files. The Webview has no Node access, uses a restrictive CSP, and all commands are schema-validated by the host.

VS Code workspace state stores session metadata only. Pi owns conversation JSONL. Draft text and pasted images stay in Webview memory. Provider credentials remain Pi-owned. Optional proxy credentials are stored in VS Code SecretStorage and are injected only into a newly started Pi process.

Proxy settings apply to Pi and child commands inheriting its environment. Changing them cannot modify an existing process; FrostPi marks the session restart-required and does not interrupt an active turn automatically.

When experimental notifications are enabled, local Windows may launch Windows PowerShell while VS Code is unfocused to publish a native notification for a completed Agent Turn, a failed Session, or required input. The script receives only fixed FrostPi notification text encoded as data. Other hosts and native-delivery failures fall back to VS Code notifications.

Diagnostic exports omit prompts/responses and redact common token, password, bearer, and URL credential forms. Paths and third-party stderr may still be sensitive and should be reviewed before sharing.
