# Security policy

## Reporting

Do not disclose suspected vulnerabilities in a public issue. Report them privately through the repository's security advisory channel or to the maintainer address published by the `frostime` publisher profile.

Include the FrostPi version, VS Code version, operating environment, reproduction steps, and a redacted diagnostic export. Do not include API keys, provider credentials, proprietary prompts, or workspace files.

## Security boundary

FrostPi starts Pi inside the trusted workspace extension host. Pi and its extensions can read and modify files and execute commands according to Pi's own configuration. FrostPi does not add a sandbox, command policy, file-write approval layer, or conflict resolver. Use only extensions and workspaces you trust.

The Webview has no Node.js access, uses a restrictive Content Security Policy, validates inbound messages, and can load only packaged Webview resources plus in-memory image data. The policy allows no origin beyond VS Code's own Webview resource host, so rendered Markdown, math and diagrams cannot make network requests to a server named in a message; a remote image is fetched by the Extension Host only after an explicit `Load image` action.
