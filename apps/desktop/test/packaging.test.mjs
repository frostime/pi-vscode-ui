import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { buildSource, createBuildInfo, sha256, verifyArchive } from "../scripts/archive-contract.mjs";
import { prepareReleaseAssets } from "../scripts/prepare-release.mjs";
import { prepareManualSmoke } from "../scripts/manual-smoke.mjs";
import { archivePayloadFiles, buildInfoFile, desktopRoot, piExtensionNames, productVersion } from "../scripts/packaging.mjs";

const temporaryDirectories = [];
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "frostpi-packaging-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureArchive(version = productVersion(), source) {
  const directory = temporaryDirectory();
  for (const file of archivePayloadFiles) {
    const path = join(directory, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file === "FrostPi.exe" ? "MZfixture" : file);
  }
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(directory, "NATIVE_NOTICES.md"), "## tauri 2\nMozilla Public License Version 2.0\n");
  const info = createBuildInfo(directory);
  info.version = version;
  if (source) info.source = source;
  writeFileSync(join(directory, buildInfoFile), JSON.stringify(info));
  const zip = new AdmZip();
  zip.addLocalFolder(directory, "FrostPi");
  return { zip, info };
}

describe("Desktop archive contract", () => {
  it("accepts a complete historical archive using its embedded version and hashes", () => {
    const { zip, info } = fixtureArchive("0.0.1-fixture");
    expect(verifyArchive(zip)).toEqual(info);
  });

  it.each([
    ["missing extension", (zip) => zip.deleteFile(`FrostPi/pi-extensions/${piExtensionNames[0]}.js`), /Incomplete Desktop archive/],
    ["unexpected file", (zip) => zip.addFile("FrostPi/forgotten.js", Buffer.from("extra")), /Unexpected\/duplicate archive entry/],
    ["changed backend", (zip) => zip.updateFile("FrostPi/backend.cjs", Buffer.from("different build")), /Payload SHA-256 mismatch: backend.cjs/],
    ["missing build information", (zip) => zip.deleteFile(`FrostPi/${buildInfoFile}`), /Incomplete Desktop archive/],
  ])("rejects %s", (_label, mutate, error) => {
    const { zip } = fixtureArchive();
    mutate(zip);
    expect(() => verifyArchive(zip)).toThrow(error);
  });

  it.skipIf(process.platform !== "win32" || process.arch !== "x64")("overwrites a stale success report when archive validation fails, without launching a GUI", () => {
    const { zip } = fixtureArchive();
    zip.updateFile("FrostPi/backend.cjs", Buffer.from("corrupt"));
    const archive = join(temporaryDirectory(), "candidate.zip");
    zip.writeZip(archive);
    writeFileSync(`${archive}.verification.json`, JSON.stringify({ ok: true }));
    const child = spawnSync(process.execPath, [resolve(desktopRoot, "scripts/verify-package.mjs"), archive], { encoding: "utf8", windowsHide: true });
    expect(child.status, child.stderr).toBe(1);
    const report = JSON.parse(readFileSync(`${archive}.verification.json`, "utf8"));
    expect(report).toMatchObject({ ok: false, checks: { archive: "failed", smoke: "not-run", realPi: "not-requested", nativeDialogs: "not-requested" } });
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.error).toContain("Payload SHA-256 mismatch: backend.cjs");
  });

  it.skipIf(process.platform !== "win32" || process.arch !== "x64")("records a native launch failure without claiming GUI success", () => {
    // The fixture has an MZ prefix but is not executable. No window or real Pi is launched.
    const { zip } = fixtureArchive();
    const archive = join(temporaryDirectory(), "invalid-executable.zip");
    zip.writeZip(archive);
    const child = spawnSync(process.execPath, [resolve(desktopRoot, "scripts/verify-package.mjs"), archive], { encoding: "utf8", windowsHide: true });
    expect(child.status, child.stderr).toBe(1);
    const report = JSON.parse(readFileSync(`${archive}.verification.json`, "utf8"));
    expect(report).toMatchObject({ ok: false, checks: { archive: "passed", smoke: "failed" }, smoke: { ok: false, checks: [] } });
    expect(report.smoke.error).toMatch(/spawn|WebView2 endpoint/);
  }, 45000);
});

describe("Desktop manual acceptance setup", () => {
  it("reopens the same validated ZIP with controlled Pi and retained test-profile settings", () => {
    const { zip } = fixtureArchive();
    const directory = temporaryDirectory();
    const archive = join(directory, "candidate.zip");
    const recordFile = join(directory, "manual.json");
    zip.writeZip(archive);
    const record = prepareManualSmoke({ archive, recordFile });
    temporaryDirectories.push(record.directory);
    const settingsFile = join(record.directory, "profile/settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(settings["frostpi.pi.executable"]).toBe(join(record.directory, "controlled-pi.cjs"));
    expect(settings["frostpi.pi.arguments"]).toContain("--stream-084-release");
    expect(record.sha256).toBe(sha256(readFileSync(archive)));
    settings["desktop.theme"] = "light";
    writeFileSync(settingsFile, JSON.stringify(settings));
    expect(prepareManualSmoke({ archive, recordFile, reopen: true })).toEqual(record);
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))["desktop.theme"]).toBe("light");
  });

  it("rejects reopening a different ZIP under an earlier manual-test record", () => {
    const directory = temporaryDirectory();
    const archive = join(directory, "candidate.zip");
    const recordFile = join(directory, "manual.json");
    fixtureArchive().zip.writeZip(archive);
    const record = prepareManualSmoke({ archive, recordFile });
    temporaryDirectories.push(record.directory);
    fixtureArchive("0.0.2-other").zip.writeZip(archive);
    expect(() => prepareManualSmoke({ archive, recordFile, reopen: true })).toThrow("ZIP changed");
  });
});

describe("Desktop release gate", () => {
  const commit = "a".repeat(40);
  function releaseFixture(source = { commit, dirty: false }) {
    const { zip, info } = fixtureArchive(productVersion(), source);
    const archive = join(temporaryDirectory(), `FrostPi-${info.version}-win32-x64.zip`);
    zip.writeZip(archive);
    const report = {
      ok: true, sha256: sha256(readFileSync(archive)), buildInfo: info,
      checks: { archive: "passed", smoke: "passed" }, smoke: { ok: true },
    };
    return { archive, report, tag: `v${info.version}` };
  }

  it("writes a checksum for the same clean, tag-matched ZIP whose GUI report passed", () => {
    const { archive, report, tag } = releaseFixture();
    writeFileSync(`${archive}.verification.json`, JSON.stringify(report));
    const assets = prepareReleaseAssets(archive, tag, commit);
    expect(assets).toEqual({ archive, checksum: `${archive}.sha256`, verification: `${archive}.verification.json` });
    expect(readFileSync(assets.checksum, "utf8")).toBe(`${report.sha256}  ${basename(archive)}\n`);
  });

  it.each([
    ["failed GUI", (report) => { report.ok = false; }, /GUI verification did not pass/],
    ["unverified smoke", (report) => { report.checks.smoke = "unverified"; }, /GUI smoke did not pass/],
    ["different ZIP", (report) => { report.sha256 = "0".repeat(64); }, /different ZIP/],
    ["missing native result", (report) => { delete report.smoke; }, /Missing successful native smoke/],
  ])("blocks publication with %s", (_label, mutate, error) => {
    const { archive, report, tag } = releaseFixture();
    mutate(report);
    writeFileSync(`${archive}.verification.json`, JSON.stringify(report));
    expect(() => prepareReleaseAssets(archive, tag, commit)).toThrow(error);
  });

  it("rejects a wrong tag, a different source commit and an uncommitted build", () => {
    const { archive, report, tag } = releaseFixture();
    writeFileSync(`${archive}.verification.json`, JSON.stringify(report));
    expect(() => prepareReleaseAssets(archive, "vwrong", commit)).toThrow("Release tag does not match");
    expect(() => prepareReleaseAssets(archive, tag, "b".repeat(40))).toThrow("different commit");
    const dirty = releaseFixture({ commit, dirty: true });
    expect(() => prepareReleaseAssets(dirty.archive, dirty.tag, commit)).toThrow("dirty or unknown source");
  });
});

describe("Desktop build provenance", () => {
  it("distinguishes clean commits, uncommitted edits and source archives without exposing file content", () => {
    const directory = temporaryDirectory();
    expect(buildSource(directory)).toEqual({ commit: null, dirty: null });
    const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
    git("init");
    writeFileSync(join(directory, "source.txt"), "original");
    git("add", "source.txt");
    git("-c", "user.name=Packaging Test", "-c", "user.email=packaging@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    const commit = git("rev-parse", "HEAD");
    expect(buildSource(directory)).toEqual({ commit, dirty: false });
    writeFileSync(join(directory, "source.txt"), "uncommitted private content");
    expect(buildSource(directory)).toEqual({ commit, dirty: true });
  });
});
