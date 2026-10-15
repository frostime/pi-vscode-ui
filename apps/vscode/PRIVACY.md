# Privacy

FrostPi contains no telemetry, analytics, advertising, account system, or remote service of its own.

FrostPi persists only local session metadata in VS Code workspace state: FrostPi session id, title, workspace path, Pi session-file path, last-update time, and active session id. It does not persist prompt bodies, responses, reasoning, tool output, pasted images, API keys, or provider credentials. Optional proxy authentication is stored separately in VS Code SecretStorage.

Prompts, images, tool calls, and model requests are sent to the locally launched Pi process. Pi and the configured model provider may store or process that data under their own settings and policies. FrostPi does not alter those data flows. Opening Provider Usage separately reads Pi's saved provider configuration and available environment credentials in the workspace Extension Host, then queries the matching official usage endpoints. This read-only feature does not refresh tokens or modify credentials. Only usage results reach the Webview; snapshots are cached in memory and are not persisted. They may describe a different account from model-specific or extension-injected session authentication.

A diagnostic export contains extension/runtime versions, session status, paths, counts, errors, and a bounded Pi stderr tail. Prompt and response content are intentionally excluded, and common token/password/bearer/URL credentials are redacted. Review diagnostics before sharing because paths and third-party stderr may still contain sensitive information.
