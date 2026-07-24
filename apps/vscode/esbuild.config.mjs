import { rmSync } from "node:fs";

import esbuild from "esbuild";

rmSync("dist", { recursive: true, force: true });

const sourcemap = process.env.FROSTPI_SOURCEMAP === "1";

await Promise.all([
  esbuild.build({
    entryPoints: ["src/extension/activate.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: "dist/extension/extension.cjs",
    external: ["vscode"],
    sourcemap,
    sourcesContent: sourcemap,
    logLevel: "info",
  }),
  esbuild.build({
    entryPoints: ["pi-extensions/session-tree.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: "dist/pi-extensions/session-tree.js",
    sourcemap,
    sourcesContent: sourcemap,
    logLevel: "info",
  }),
  esbuild.build({
    entryPoints: ["pi-extensions/question-tool.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: "dist/pi-extensions/question-tool.js",
    sourcemap,
    sourcesContent: sourcemap,
    logLevel: "info",
  }),
]);
