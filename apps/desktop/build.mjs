import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { build as buildRenderer } from "vite";
import { piExtensionNames } from "./scripts/packaging.mjs";

// Internal product compilation; scripts/build.mjs prepares shared dependencies.
await rm(new URL("./dist", import.meta.url), { recursive: true, force: true });

await Promise.all([
  ...piExtensionNames.map((name) => build({
    entryPoints: [`../pi-client/pi-extensions/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: `dist/pi-extensions/${name}.js`,
  })),
  build({ entryPoints: ["src/main/backend.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: "dist/backend.cjs", banner: { js: '"use strict";require("node:fs").writeSync(1,JSON.stringify({kind:"hello",protocol:1,node:process.versions.node})+"\\n");' } }),
]);

await buildRenderer();
