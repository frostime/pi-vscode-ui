import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { sha256, verifyArchive } from "./archive-contract.mjs";
import { artifactsRoot, distributedArchive, repositoryRoot } from "./packaging.mjs";
import { configuredGuiPath } from "./windows-gui-path.mjs";

/** Prepare controlled manual tests, not the normal development profile or a GUI pass attestation. */
export function prepareManualSmoke({ archive, recordFile, reopen = false }) {
  const bytes = readFileSync(archive);
  const zip = new AdmZip(bytes);
  verifyArchive(zip);
  const hash = sha256(bytes);
  let record;
  if (reopen) {
    record = JSON.parse(readFileSync(recordFile, "utf8"));
    assert.equal(record.sha256, hash, "ZIP changed. Start a new manual test without --reopen.");
    assert.ok(existsSync(join(record.directory, "profile/settings.json")) && existsSync(join(record.directory, "controlled-pi.cjs")), "Manual test profile is missing. Start again without --reopen.");
  } else {
    const directory = mkdtempSync(join(tmpdir(), "frostpi-desktop-manual-"));
    record = { archive: resolve(archive), sha256: hash, directory, createdAt: new Date().toISOString() };
    for (const name of ["profile", "pi-agent", "project-a", "project-b", "sessions"]) mkdirSync(join(directory, name));
    const fixture = join(directory, "controlled-pi.cjs");
    cpSync(join(repositoryRoot, "apps/pi-client/test/fixtures/fake-pi.cjs"), fixture);
    writeFileSync(join(directory, "profile/settings.json"), JSON.stringify({
      "frostpi.pi.executable": fixture,
      "frostpi.pi.arguments": ["--persist-session-fixture", "--session-dir", join(directory, "sessions"), "--stream-084-release", join(directory, "release-stream")],
      "frostpi.session.startOnOpen": true,
      "desktop.theme": "dark",
    }, null, 2));
  }
  // Re-extract the same validated payload on reopen; retain only the separate test profile/projects.
  zip.extractAllTo(record.directory, true);
  mkdirSync(dirname(recordFile), { recursive: true });
  writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n");
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Manual Desktop smoke supports Windows x64 only.");
  const args = process.argv.slice(2);
  assert.ok(args.every((arg) => arg === "--reopen"), "Supported option: --reopen");
  const record = prepareManualSmoke({ archive: distributedArchive(), recordFile: join(artifactsRoot, "desktop-manual.json"), reopen: args.includes("--reopen") });
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  environment.Path = configuredGuiPath().value;
  environment.FROSTPI_DESKTOP_USER_DATA = join(record.directory, "profile");
  environment.PI_CODING_AGENT_DIR = join(record.directory, "pi-agent");
  console.log(`Manual test ZIP SHA-256: ${record.sha256}`);
  console.log(`Isolated FrostPi profile: ${environment.FROSTPI_DESKTOP_USER_DATA}`);
  console.log("Controlled Pi: hello -> E2E response; stream-084 -> stays active until Stop. No model requests.");
  const child = spawn(join(record.directory, "FrostPi/FrostPi.exe"), [join(record.directory, "project-a"), join(record.directory, "project-b")], {
    cwd: record.directory, env: environment, windowsHide: true, stdio: "inherit",
  });
  child.once("error", () => { console.error("Could not start the manual-test executable."); process.exitCode = 1; });
  child.once("exit", (code) => {
    console.log(`Test application exited (${code}). This does not mark manual acceptance as passed.`);
    console.log("Reopen the same test profile: pnpm test:desktop:manual --reopen");
    process.exitCode = code ?? 1;
  });
}
