import { build } from "esbuild";

await Promise.all([
  ...["session-tree", "question-tool"].map((name) => build({
    entryPoints: [`../pi-client/pi-extensions/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: `dist/pi-extensions/${name}.js`,
  })),
  build({ entryPoints: ["src/tauri/backend.ts"], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: "dist/backend.cjs", banner: { js: '"use strict";require("node:fs").writeSync(1,JSON.stringify({kind:"hello",protocol:1,node:process.versions.node})+"\\n");' } }),
  build({
    entryPoints: ["src/main/main.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: "dist/main.cjs",
    external: ["electron"],
  }),
  build({
    entryPoints: ["src/preload.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: "dist/preload.cjs",
    external: ["electron"],
  }),
]);
