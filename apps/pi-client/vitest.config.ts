import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@frostime\/pi-client\/core$/, replacement: resolve(import.meta.dirname, "src/core/index.ts") },
      { find: /^@frostime\/pi-client\/core\//, replacement: `${resolve(import.meta.dirname, "src/core")}/` },
      { find: /^@frostime\/pi-client\/shared$/, replacement: resolve(import.meta.dirname, "src/shared/index.ts") },
      { find: /^@frostime\/pi-client\/shared\//, replacement: `${resolve(import.meta.dirname, "src/shared")}/` },
      { find: /^@frostime\/pi-client\/host$/, replacement: resolve(import.meta.dirname, "src/host/index.ts") },
      { find: /^@frostime\/pi-client\/host\//, replacement: `${resolve(import.meta.dirname, "src/host")}/` },
      { find: "@frostime/pi-rpc", replacement: resolve(import.meta.dirname, "../../packages/pi-rpc/src/index.ts") },
      { find: "@frostime/provider-usage", replacement: resolve(import.meta.dirname, "../../packages/provider-usage/src/index.ts") },
    ],
  },
  test: { setupFiles: ["test/isolatePiSettings.ts"] },
});
