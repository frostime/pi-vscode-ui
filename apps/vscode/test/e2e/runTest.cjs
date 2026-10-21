const { cp, mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index.cjs");
  // A fixture inside this Git repository discovers sibling worktrees and opens
  // an interactive directory picker. Keep the automated session outside Git.
  const workspacePath = await mkdtemp(path.join(tmpdir(), "frostpi-e2e-"));
  try {
    await cp(path.resolve(__dirname, "fixtures/workspace"), workspacePath, { recursive: true });
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
    });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
