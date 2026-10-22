import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const manifestPath = new URL("../../vscode/package.json", import.meta.url);
const outputPath = new URL("../src/core/configuration/frostPiSettingDefaults.generated.ts", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const defaults = {};
for (const [key, definition] of Object.entries(manifest.contributes.configuration.properties)) {
  if (!key.startsWith("frostpi.") || !Object.hasOwn(definition, "default")) {
    throw new Error(`Expected a FrostPi setting with an explicit default: ${key}`);
  }
  defaults[key.slice("frostpi.".length)] = definition.default;
}
const source = `// Generated from apps/vscode/package.json; do not edit.\n// Regenerate: pnpm --dir apps/pi-client settings:generate\nexport const frostPiSettingDefaults = ${JSON.stringify(defaults, null, 2)} as const;\n`;

const args = process.argv.slice(2);
if (args.length === 0) {
  writeFileSync(outputPath, source);
  console.log(`Generated ${fileURLToPath(outputPath)}`);
} else if (args.length === 1 && args[0] === "--check") {
  if (readFileSync(outputPath, "utf8").replaceAll("\r\n", "\n") !== source) {
    throw new Error("Shared setting defaults are stale. Run: pnpm --dir apps/pi-client settings:generate");
  }
} else {
  throw new Error("Usage: node scripts/generate-setting-defaults.mjs [--check]");
}
