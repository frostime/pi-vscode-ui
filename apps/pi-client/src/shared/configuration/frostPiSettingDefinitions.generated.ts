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
    "description": "After a turn completes, collapse tools, reasoning, and interim replies into one summary above the final response."
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
    "description": "Maximum size in bytes for each pasted image."
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
    "default": true,
    "scope": "resource",
    "description": "Follow symbolic links during @ path completion."
  }
} as const;
