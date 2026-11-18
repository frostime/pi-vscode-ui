import * as vscode from "vscode";

/**
 * `sessionId` marks a Session Tab: the page saves it as its Webview state, which VS Code
 * hands back to restore the tab after a restart.
 */
export function createWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, sessionId?: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "webview.css"));
  const nonce = createNonce();
  // Only VS Code's own Webview resource host is granted. Rendered content (Mermaid,
  // KaTeX, CSS) therefore cannot reach a server it names; consented remote Markdown
  // images arrive as Host-fetched bytes instead.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};" />
  <link rel="stylesheet" href="${styleUri.toString()}" />${sessionId === undefined ? "" : `
  <meta name="${SESSION_TAB_META}" content="${escapeAttribute(sessionId)}" />`}
  <title>FrostPi</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

/** Read by the page's VS Code bridge; keep in step with `src/webview/bridge/vscodeBridge.ts`. */
const SESSION_TAB_META = "frostpi-session-tab";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}
