const { cp, mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { spawn, spawnSync } = require("node:child_process");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { downloadAndUnzipVSCode, runTests } = require("@vscode/test-electron");

async function runIsolated(directory) {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const profile = path.join(directory, "profile");
  const workspace = path.join(directory, "workspace");
  await cp(path.resolve(__dirname, "fixtures/workspace"), workspace, { recursive: true });
  await mkdir(path.join(profile, "User"), { recursive: true });
  await mkdir(path.join(directory, "pi"), { recursive: true });
  await writeFile(path.join(profile, "User/settings.json"), JSON.stringify({
    "telemetry.telemetryLevel": "off", "workbench.startupEditor": "none", "update.mode": "none",
  }));
  // The SDK download may need the caller's proxy. Sanitize only the subsequent test launch.
  const executable = process.env.FROSTPI_VSCODE_EXECUTABLE ?? await downloadAndUnzipVSCode();
  // Sanitize this test subprocess only. Never change Pi's production launch policy.
  for (const key of Object.keys(process.env)) {
    if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|VSCODE_PID|VSCODE_IPC_HOOK_CLI|VSCODE_CWD|VSCODE_NLS_CONFIG|VSCODE_NODE_OPTIONS|https?_proxy|all_proxy|no_proxy)$/i.test(key)) delete process.env[key];
  }
  process.env.PI_CODING_AGENT_DIR = path.join(directory, "pi");
  process.env.VSCODE_DISABLE_TELEMETRY = "1";
  process.env.FROSTPI_E2E_RESULT = path.join(directory, "suite-result.json");
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve(__dirname, "suite/index.cjs"),
    launchArgs: [workspace, "--user-data-dir", profile, "--extensions-dir", path.join(directory, "extensions"), "--disable-extensions", "--disable-gpu"],
  });
}

/** Kill only this runner's owned process tree, never a process-name wildcard. */
function stopRunner(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    if (result.status !== 0) throw new Error("Could not stop the owned extension-test process tree.");
  } else {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "FrostPi extension E2E "));
  console.log(`Extension E2E artifacts: ${directory}`);
  const timeoutMs = Number(process.env.FROSTPI_E2E_TIMEOUT_MS ?? 180_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid extension-test timeout.");
  const child = spawn(process.execPath, [__filename, "--isolated-runner", directory], { stdio: "inherit", detached: process.platform !== "win32" });
  let interruption;
  let rejectInterruption;
  const interrupted = new Promise((_resolve, reject) => { rejectInterruption = reject; });
  const stop = (reason) => {
    interruption = reason;
    try { stopRunner(child); }
    catch { interruption = `${reason}; owned process-tree cleanup failed (PID ${String(child.pid)})`; }
    rejectInterruption(new Error(`Extension tests ${interruption}.`));
  };
  const onInterrupt = () => stop("cancelled");
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  try {
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (exitCode) => resolve(exitCode));
    });
    const code = await Promise.race([exited, interrupted]);
    if (interruption) throw new Error(`Extension tests ${interruption}.`);
    if (code !== 0) throw new Error(`Extension-test runner exited with code ${String(code)}.`);
    const proof = JSON.parse(await readFile(path.join(directory, "suite-result.json"), "utf8"));
    if (proof.ok !== true || proof.suiteCompleted !== true) throw new Error("Extension test suite did not complete.");
    await writeFile(path.join(directory, "result.json"), JSON.stringify(proof));
    console.log(JSON.stringify(proof));
  } catch (error) {
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ ok: false, reason: interruption ?? "test did not complete" }));
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
    if (interruption) child.unref();
  }
}

const operation = process.argv[2] === "--isolated-runner" ? runIsolated(process.argv[3]) : main();
operation.catch((error) => { console.error(error); process.exitCode = 1; });
