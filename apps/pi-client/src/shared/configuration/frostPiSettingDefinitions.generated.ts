// Generated from apps/vscode/package.json; do not edit.
// Regenerate: node apps/pi-client/scripts/generate-setting-defaults.mjs
export const frostPiSettingDefinitions = {
  "frostpi.pi.executable": {
    "type": "string",
    "default": "",
    "scope": "machine-overridable",
    "description": "Optional Pi executable or Node.js CLI path. Leave empty to resolve the selected runtime from PATH."
  },
  "frostpi.pi.runtimeCompatibility": {
    "type": "string",
    "enum": [
      "pi",
      "oh-my-pi"
    ],
    "enumDescriptions": [
      "Existing Pi behavior and Pi settings semantics.",
      "Limited FrostPi compatibility with Oh My Pi launch, RPC, session discovery, and resume; this does not represent complete OMP support."
    ],
    "default": "pi",
    "scope": "resource",
    "description": "Select FrostPi's limited compatibility contract for a Pi-compatible runtime; this does not claim support for all runtime-specific features."
  },
  "frostpi.pi.arguments": {
    "type": "array",
    "items": {
      "type": "string"
    },
    "default": [],
    "scope": "resource",
    "description": "Additional arguments passed after `pi --mode rpc`."
  },
  "frostpi.session.startOnOpen": {
    "type": "boolean",
    "default": true,
    "scope": "resource",
    "description": "When a previously selected session exists, start its Pi process when FrostPi activates. Does not create a new session if none exist."
  },
  "frostpi.session.closeWithEditorTab": {
    "type": "boolean",
    "default": false,
    "scope": "resource",
    "description": "Closing a session's editor tab also closes the session: its Pi process stops and it leaves the session list, as Close session in the list does. Pi's session file is kept, so Resume session can reopen it. When off, the session keeps running in the sidebar."
  },
  "frostpi.composer.streamingBehavior": {
    "type": "string",
    "enum": [
      "steer",
      "followUp"
    ],
    "enumDescriptions": [
      "Deliver while the current run is active, after current tool calls.",
      "Deliver only after the current run fully settles."
    ],
    "default": "followUp",
    "scope": "resource",
    "description": "Default delivery for normal prompts submitted while Pi is streaming. The Composer can override it per session; extension commands execute immediately."
  },
  "frostpi.conversation.collapseTurnTrace": {
    "type": "boolean",
    "default": true,
    "scope": "resource",
    "description": "After a turn completes, fold its tool calls, reasoning and interim replies into one summary above the final reply. Inside an opened summary, each run of tool calls and reasoning stays folded into one row. How a turn folds while it is still running is controlled by frostpi.conversation.collapseRunningTurnTrace."
  },
  "frostpi.conversation.collapseRunningTurnTrace": {
    "type": "boolean",
    "default": true,
    "scope": "resource",
    "description": "While a turn is still running, fold each run of consecutive tool calls and reasoning into one expandable row. Replies stay visible. A finished turn keeps these rows unless frostpi.conversation.collapseTurnTrace folds it into one summary. \"FrostPi: Toggle Running-Turn Collapse (Focus View)\" switches it."
  },
  "frostpi.questionTool.enabled": {
    "type": "boolean",
    "default": false,
    "scope": "resource",
    "description": "Inject FrostPi's private question tool when a Pi session process starts. Running sessions must be restarted after this setting changes."
  },
  "frostpi.attachments.maxImageBytes": {
    "type": "number",
    "minimum": 1048576,
    "maximum": 52428800,
    "default": 10485760,
    "scope": "resource",
    "description": "Maximum size in bytes per image. Pasted images over this limit cannot be attached. Images loaded from local files or HTTPS links in the conversation are also rejected if they exceed the limit."
  },
  "frostpi.diagnostics.level": {
    "type": "string",
    "enum": [
      "error",
      "info",
      "debug"
    ],
    "default": "info",
    "scope": "window",
    "description": "Verbosity of the FrostPi output channel. Prompt and model content are not logged."
  },
  "frostpi.notifications.experimental.enabled": {
    "type": "boolean",
    "default": false,
    "scope": "window",
    "description": "Experimental: Notify when an agent turn completes, a session fails, or FrostPi waits for input while the VS Code window is unfocused. Local Windows uses a native PowerShell toast; unavailable native delivery falls back to a VS Code notification."
  },
  "frostpi.network.proxy.mode": {
    "type": "string",
    "enum": [
      "inherit",
      "vscode",
      "custom",
      "direct"
    ],
    "enumDescriptions": [
      "Inherit the Extension Host environment.",
      "Use the VS Code http.proxy setting.",
      "Inject FrostPi custom proxy variables.",
      "Remove inherited proxy variables for Pi."
    ],
    "default": "inherit",
    "scope": "machine-overridable",
    "description": "Proxy mode applied when a Pi session process starts. Running sessions must be restarted."
  },
  "frostpi.network.proxy.endpoint": {
    "type": "string",
    "default": "",
    "scope": "machine-overridable",
    "description": "Custom proxy endpoint for custom mode. host:port or http(s)://… sets HTTP_PROXY and HTTPS_PROXY; socks5://… sets ALL_PROXY. Store authentication through the FrostPi credentials command."
  },
  "frostpi.network.proxy.noProxy": {
    "type": "string",
    "default": "localhost,127.0.0.1,::1",
    "scope": "machine-overridable",
    "description": "Comma-separated hosts that bypass the proxy. Defaults to local loopback addresses. Edit in Settings when the default loopback list is not enough."
  },
  "frostpi.composer.fileMentions.respectSearchExclude": {
    "type": "boolean",
    "default": true,
    "scope": "resource",
    "description": "Exclude paths matched by VS Code search.exclude from @ path completion."
  },
  "frostpi.composer.fileMentions.respectIgnoreFiles": {
    "type": "boolean",
    "default": true,
    "scope": "resource",
    "description": "Respect .gitignore, .ignore, .fdignore, and global ignore rules during @ path completion."
  },
  "frostpi.composer.fileMentions.followSymlinks": {
    "type": "boolean",
    "default": false,
    "scope": "resource",
    "description": "Follow symbolic links during @ path completion. Off by default: a link to a large directory outside the workspace, or a link loop, can make the search slow or fill it with duplicates."
  }
} as const;
