import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMsiUpdateManifest,
  finalizeMsiArtifacts,
  msiBuildEnvironment,
  msiBuildOverride,
  msiSigningConfiguration,
  validateMsiRelease,
} from "../scripts/msi-contract.mjs";
import {
  msiAssetPaths,
  msiSupportFiles,
  productVersion,
  repositoryRoot,
  runtimePackageMetadata,
} from "../scripts/packaging.mjs";

const temporaryDirectories = [];
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "frostpi-msi-packaging-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// Opaque signer output: key parsing and cryptography belong to Tauri, not FrostPi.
const signature = Buffer.from("fixture signer output").toString("base64");
const publicKey = Buffer.from("fixture public key").toString("base64");

function fixture() {
  const version = "0.16.0";
  const artifactRoot = temporaryDirectory();
  const paths = msiAssetPaths(version, artifactRoot);
  writeFileSync(paths.msi, "fixture installer; never executed");
  writeFileSync(paths.signature, `${signature}\n`);
  return { version, artifactRoot, paths };
}

describe("Desktop MSI packaging", () => {
  it("creates the versioned MSI update target from the signer output", () => {
    expect(createMsiUpdateManifest({ version: "0.16.0", signature })).toEqual({
      version: "0.16.0",
      platforms: {
        "windows-x86_64-msi": {
          url: "https://github.com/frostime/pi-vscode-ui/releases/download/v0.16.0/FrostPi-0.16.0-win32-x64.msi",
          signature,
        },
      },
    });
    expect(createMsiUpdateManifest({ signature }).version).toBe(productVersion());
  });

  it("bundles shared support files and embeds the updater public key", () => {
    const override = msiBuildOverride(publicKey);
    expect(override).toEqual({
      bundle: {
        active: true,
        targets: ["msi"],
        createUpdaterArtifacts: false,
        resources: Object.fromEntries(msiSupportFiles.map((file) => [`../dist/msi/${file}`, file])),
      },
      plugins: { updater: { pubkey: publicKey } },
    });
    expect(runtimePackageMetadata()).toEqual({ name: "frostpi-desktop", private: true, type: "module", version: productVersion() });
    expect(override.bundle.resources["../dist/msi/package.json"]).toBe("package.json");
  });

  it("keeps private signing inputs out of builds and passes them to the signer", () => {
    const environment = {
      FROSTPI_UPDATE_PUBLIC_KEY: publicKey,
      TAURI_SIGNING_PRIVATE_KEY: "fixture private key",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "fixture password",
      PATH: "fixture path",
    };
    expect(msiSigningConfiguration(environment)).toEqual({ publicKey, environment });
    expect(msiBuildEnvironment(environment)).toEqual({ FROSTPI_UPDATE_PUBLIC_KEY: publicKey, PATH: "fixture path" });
    expect(environment.TAURI_SIGNING_PRIVATE_KEY).toBe("fixture private key");
  });

  it("rejects missing signing configuration before building", () => {
    expect(() => msiSigningConfiguration({})).toThrow(/FROSTPI_UPDATE_PUBLIC_KEY/);
    expect(() => msiSigningConfiguration({ FROSTPI_UPDATE_PUBLIC_KEY: publicKey })).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);
  });

  it("writes only the manifest beside the installer and signature, then accepts the release set", () => {
    const target = fixture();
    finalizeMsiArtifacts(target);
    expect(JSON.parse(readFileSync(target.paths.manifest, "utf8"))).toEqual(createMsiUpdateManifest({ version: target.version, signature }));
    expect(readdirSync(target.artifactRoot).sort()).toEqual([
      "FrostPi-0.16.0-win32-x64.msi",
      "FrostPi-0.16.0-win32-x64.msi.sig",
      "FrostPi-desktop-update.json",
    ]);
    expect(validateMsiRelease({ ...target, tag: `v${target.version}` })).toEqual(target.paths);
  });

  it("fails on missing or invalid signer output without announcing an update", () => {
    const target = fixture();
    rmSync(target.paths.signature);
    expect(() => finalizeMsiArtifacts(target)).toThrow(/ENOENT/);
    expect(existsSync(target.paths.manifest)).toBe(false);
    writeFileSync(target.paths.signature, "not base64");
    expect(() => finalizeMsiArtifacts(target)).toThrow(/base64/);
    expect(existsSync(target.paths.manifest)).toBe(false);
  });

  it("rejects a tag or manifest that does not describe the packaged release", () => {
    const target = fixture();
    finalizeMsiArtifacts(target);
    expect(() => validateMsiRelease({ ...target, tag: "v0.15.0" })).toThrow(/Release tag/);
    const manifest = createMsiUpdateManifest({ version: "0.15.0", signature });
    writeFileSync(target.paths.manifest, JSON.stringify(manifest));
    expect(() => validateMsiRelease({ ...target, tag: `v${target.version}` })).toThrow(/update manifest/);
  });
});

describe("Desktop MSI packaging commands", () => {
  it.each([
    ["package-msi.mjs", ["--skip-build"]],
    ["prepare-msi-release.mjs", ["v0.16.0", "--unknown"]],
  ])("rejects unsupported arguments before doing work: %s", (script, args) => {
    const child = spawnSync(process.execPath, [join(repositoryRoot, "apps/desktop/scripts", script), ...args], {
      cwd: repositoryRoot,
      env: msiBuildEnvironment(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(1);
    expect(child.stderr).toContain("Usage:");
    expect(child.stdout).not.toMatch(/Packaged |Prepared |\[package:msi\]|\[build/);
  });
});
