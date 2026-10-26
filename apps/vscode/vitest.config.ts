import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.js";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    server: { deps: { inline: ["katex"] } },
    projects: [
      {
        extends: true,
        test: { name: "unit", exclude: [...configDefaults.exclude, "**/*.dom.test.ts"] },
      },
      {
        extends: true,
        resolve: { conditions: ["browser"] },
        ssr: { noExternal: ["@testing-library/svelte", "@testing-library/svelte-core"] },
        test: { name: "dom", environment: "jsdom", include: ["test/unit/**/*.dom.test.ts"] },
      },
    ],
  },
}));
