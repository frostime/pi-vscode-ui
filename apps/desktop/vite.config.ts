import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const client = resolve(import.meta.dirname, "../pi-client/src");
const clientRequire = createRequire(resolve(import.meta.dirname, "../pi-client/package.json"));

export default defineConfig({
  root: resolve(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [
    svelte(),
    {
      name: "frostpi-desktop-mermaid",
      writeBundle() {
        const directory = resolve(import.meta.dirname, "dist/renderer/vendor");
        mkdirSync(directory, { recursive: true });
        cpSync(resolve(dirname(clientRequire.resolve("mermaid/package.json")), "dist/mermaid.min.js"), resolve(directory, "mermaid.min.js"));
      },
    },
  ],
  resolve: {
    alias: [
      { find: "$shared", replacement: resolve(client, "shared") },
      { find: "$webview", replacement: resolve(client, "ui") },
      { find: "$ui", replacement: resolve(client, "ui") },
      { find: /^@frostime\/pi-client\/ui$/, replacement: resolve(client, "ui/ClientApp.svelte") },
      { find: /^@frostime\/pi-client\/ui\//, replacement: `${resolve(client, "ui")}/` },
      { find: /^@frostime\/pi-client\/shared\//, replacement: `${resolve(client, "shared")}/` },
      { find: "@frostime/pi-rpc", replacement: resolve(import.meta.dirname, "../../packages/pi-rpc/src/index.ts") },
      { find: "@frostime/provider-usage/types", replacement: resolve(import.meta.dirname, "../../packages/provider-usage/src/publicTypes.ts") },
    ],
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 800,
  },
});
