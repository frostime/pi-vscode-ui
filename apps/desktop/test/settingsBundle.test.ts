import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("reads JSONC from the bundled Node entry without unresolved UMD requires", async () => {
  const root = await mkdtemp(join(tmpdir(), "frostpi-settings-bundle-"));
  try {
    const bundle = join(root, "settings-reader.cjs");
    const settings = join(root, "settings.json");
    await writeFile(settings, '\uFEFF{ // user config\n "chat.fontSize": 18, }');
    await build({
      entryPoints: [resolve(import.meta.dirname, "../src/main/settings/readSettingsObject.ts")],
      bundle: true, platform: "node", format: "cjs", outfile: bundle,
    });
    const result = await promisify(execFile)(process.execPath, ["-e", `
      const {readSettingsObject} = require(${JSON.stringify(bundle)});
      readSettingsObject(${JSON.stringify(settings)}).then(values => {
        if (values['chat.fontSize'] !== 18) process.exit(1);
      }).catch(() => process.exit(1));
    `]);
    expect(result.stderr).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
