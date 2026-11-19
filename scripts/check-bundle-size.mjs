import { statSync } from "node:fs";
import { resolve } from "node:path";

import { root } from "./lib.mjs";

const budgets = new Map([
  ["apps/vscode/dist/extension/extension.cjs", 1_200_000],
  ["apps/vscode/dist/webview/webview.js", 870_000], // CodeMirror, session tabs and worker transcripts
  ["apps/vscode/dist/webview/webview.css", 166_000], // Question rows, worker status and transcript panel
]);
let failed = false;
for (const [relative, budget] of budgets) {
  const size = statSync(resolve(root, relative)).size;
  console.log(`${relative}: ${(size / 1024).toFixed(1)} KiB / ${(budget / 1024).toFixed(1)} KiB`);
  if (size > budget) failed = true;
}
if (failed) throw new Error("A production bundle exceeded its size budget.");
