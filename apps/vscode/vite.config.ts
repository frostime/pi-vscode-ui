import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);

/** Copy Mermaid's self-contained IIFE next to webview.js for script-tag loading. */
function copyMermaidVendor(): Plugin {
  return {
    name: "frostpi-copy-mermaid-vendor",
    writeBundle(outputOptions) {
      const outDir = outputOptions.dir ?? resolve(import.meta.dirname, "dist/webview");
      const vendorDir = resolve(outDir, "vendor");
      mkdirSync(vendorDir, { recursive: true });
      const mermaidEntry = require.resolve("mermaid/package.json");
      const mermaidMin = resolve(dirname(mermaidEntry), "dist/mermaid.min.js");
      cpSync(mermaidMin, resolve(vendorDir, "mermaid.min.js"));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [svelte(), copyMermaidVendor()],
  resolve: {
    alias: [
      { find: "$shared", replacement: resolve(import.meta.dirname, "../pi-client/src/shared") },
      { find: "$webview", replacement: resolve(import.meta.dirname, "../pi-client/src/ui") },
      { find: "$ui", replacement: resolve(import.meta.dirname, "../pi-client/src/ui") },
      { find: /^@frostime\/pi-client\/host$/, replacement: resolve(import.meta.dirname, "../pi-client/src/host/index.ts") },
      { find: /^@frostime\/pi-client\/host\//, replacement: `${resolve(import.meta.dirname, "../pi-client/src/host")}/` },
      { find: /^@frostime\/pi-client\/ui$/, replacement: resolve(import.meta.dirname, "../pi-client/src/ui/ClientApp.svelte") },
      { find: /^@frostime\/pi-client\/ui\//, replacement: `${resolve(import.meta.dirname, "../pi-client/src/ui")}/` },
      { find: /^@frostime\/pi-client\/core$/, replacement: resolve(import.meta.dirname, "../pi-client/src/core/index.ts") },
      { find: /^@frostime\/pi-client\/core\//, replacement: `${resolve(import.meta.dirname, "../pi-client/src/core")}/` },
      { find: /^@frostime\/pi-client\/shared$/, replacement: resolve(import.meta.dirname, "../pi-client/src/shared/index.ts") },
      { find: /^@frostime\/pi-client\/shared\//, replacement: `${resolve(import.meta.dirname, "../pi-client/src/shared")}/` },
      { find: "@frostime/pi-rpc", replacement: resolve(import.meta.dirname, "../../packages/pi-rpc/src/index.ts") },
      { find: "@frostime/provider-usage/types", replacement: resolve(import.meta.dirname, "../../packages/provider-usage/src/publicTypes.ts") },
      { find: /^@frostime\/provider-usage$/, replacement: resolve(import.meta.dirname, "../../packages/provider-usage/src/index.ts") },
    ],
  },
  build: {
    outDir: "dist/webview",
    emptyOutDir: false,
    sourcemap: process.env.FROSTPI_SOURCEMAP === "1",
    cssCodeSplit: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: resolve(import.meta.dirname, "src/webview/main.ts"),
      output: {
        entryFileNames: "webview.js",
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith(".css") ? "webview.css" : "assets/[name][extname]",
        chunkFileNames: "chunks/[name].js",
      },
    },
  },
});
