import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

import { root, run } from "../lib.mjs";
import { buildSteps, packagesForScope } from "../workspaces.mjs";

test("Node orchestration preserves arguments containing spaces", () => {
  const value = "argument containing spaces";
  const output = run(process.execPath, ["-p", "JSON.stringify(process.argv.slice(1))", value], { capture: true });
  assert.deepEqual(JSON.parse(output), [value]);
});

const sharedPackages = ["@frostime/pi-rpc", "@frostime/provider-usage", "@frostime/pi-client"];
const vscode = "frostpi";
const desktop = "@frostime/frostpi-desktop";

for (const [scope, products] of [["all", [vscode, desktop]], ["vscode", [vscode]], ["desktop", [desktop]]]) {
  test(`${scope} build prepares shared dependencies once and compiles only selected products`, () => {
    assert.deepEqual(buildSteps(scope), [
      { packageName: "@frostime/pi-client", script: "build" },
      ...products.map((packageName) => ({ packageName, script: "build:local" })),
    ]);
  });
}

test("extension quality includes shared packages but never Desktop", () => {
  assert.deepEqual(packagesForScope("vscode"), [...sharedPackages, vscode]);
  assert.deepEqual(packagesForScope(), [...sharedPackages, vscode, desktop]);
});

// Run guard tests outside the checkout: a regressed clean/package guard must not
// delete real artifacts or launch a real build before the assertion can fail.
const fixtureRoot = mkdtempSync(join(tmpdir(), "frostpi-command-test-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
writeFileSync(join(fixtureRoot, "package.json"), '{"name":"command-fixture","private":true}\n');
writeFileSync(join(fixtureRoot, "pnpm-workspace.yaml"), "packages: []\n");
mkdirSync(join(fixtureRoot, "scripts"));
for (const name of readdirSync(resolve(root, "scripts"))) {
  if (name.endsWith(".mjs")) copyFileSync(resolve(root, "scripts", name), join(fixtureRoot, "scripts", name));
}
symlinkSync(resolve(root, "node_modules"), join(fixtureRoot, "node_modules"), "junction");

const invalidInvocations = [
  ["scripts/build.mjs", ["--vscdoe"], /Unknown option/],
  ["scripts/build.mjs", ["--scope", "vscdoe"], /Expected --scope/],
  ["scripts/build.mjs", ["--scope", "vscode", "unexpected"], /Unexpected argument/],
  ["scripts/build.mjs", ["--scope", "vscode", "--scope", "all"], /Pass --scope only once/],
  ["scripts/check.mjs", ["--vscdoe"], /Unknown option/],
  ["scripts/check.mjs", ["--scope", "desktop"], /Expected --scope/],
  ["scripts/quality.mjs", ["test", "--watch"], /Usage:/],
  ["scripts/quality.mjs", ["typo"], /Usage:/],
  ["scripts/clean.mjs", ["--vscode"], /Usage:/],
  ["scripts/package-vsix.mjs", ["--skip-build"], /Usage:/],
  ["scripts/package-source.mjs", ["--unknown"], /Usage:/],
  ["scripts/verify-vsix.mjs", ["--unknown"], /Usage:/],
];

for (const [script, args, expectedError] of invalidInvocations) {
  test(`${script} rejects ${args.join(" ")} before doing work`, () => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: fixtureRoot, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(result.stdout, /\[build\]|\[check\]|> .* (?:build|lint|test|clean)|Created |Packaged /);
  });
}
