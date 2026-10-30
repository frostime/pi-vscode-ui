import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";
import tseslint from "typescript-eslint";

const typedTypeScript = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ["**/*.ts", "**/*.tsx", "**/*.svelte.ts"],
}));

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/artifacts/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...typedTypeScript,
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.svelte.ts"],
    languageOptions: {
      parser: tseslint.parser,
      // Match the Svelte extension set below; switching sets reloads the TypeScript project.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname, extraFileExtensions: [".svelte"] },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["apps/pi-client/src/{core,host}/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["vscode", "vscode/*", "electron", "**/apps/vscode/**", "**/apps/desktop/**", "**/ui/**", "**/webview/**", "$shared/*", "$webview/*", "$ui/*"] }],
    },
  },
  {
    files: ["apps/pi-client/src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@frostime/pi-rpc", allowTypeImports: true, message: "Shared definitions may import RPC types only." }],
        patterns: ["node:*", "vscode", "vscode/*", "electron", "**/apps/vscode/**", "**/apps/desktop/**", "**/core/**", "**/host/**", "@frostime/pi-client/core", "@frostime/pi-client/core/*", "@frostime/pi-client/host", "@frostime/pi-client/host/*", "svelte", "svelte/*"],
      }],
    },
  },
  {
    files: ["apps/vscode/src/webview/**/*.{ts,svelte}", "apps/pi-client/src/ui/**/*.{ts,svelte}", "apps/desktop/src/renderer/**/*.{ts,svelte}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["node:*", "vscode", "vscode/*", "electron", "@frostime/pi-client/core", "@frostime/pi-client/core/*", "@frostime/pi-client/host", "@frostime/pi-client/host/*"] }],
    },
  },
  {
    files: ["**/*.cjs", "**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".svelte"],
      },
      globals: { ...globals.browser },
    },
    rules: {
      "svelte/no-at-html-tags": "off",
      "svelte/prefer-svelte-reactivity": "off",
      "no-unused-vars": "off",
    },
  },
);
