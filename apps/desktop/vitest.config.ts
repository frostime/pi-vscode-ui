import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const client = resolve(import.meta.dirname, "../pi-client/src");
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@frostime\/pi-client\/host$/, replacement: resolve(client, "host/index.ts") },
      { find: /^@frostime\/pi-client\/host\//, replacement: `${resolve(client, "host")}/` },
      { find: /^@frostime\/pi-client\/core$/, replacement: resolve(client, "core/index.ts") },
      { find: /^@frostime\/pi-client\/core\//, replacement: `${resolve(client, "core")}/` },
      { find: /^@frostime\/pi-client\/shared\//, replacement: `${resolve(client, "shared")}/` },
      { find: "@frostime/pi-rpc", replacement: resolve(import.meta.dirname, "../../packages/pi-rpc/src/index.ts") },
      { find: "@frostime/provider-usage", replacement: resolve(import.meta.dirname, "../../packages/provider-usage/src/index.ts") },
    ],
  },
  test: { include: ["test/**/*.test.{ts,mjs}"], setupFiles: ["../pi-client/test/isolatePiSettings.ts"] },
});
