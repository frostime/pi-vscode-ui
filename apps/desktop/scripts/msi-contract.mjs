import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import {
  artifactsRoot,
  msiAssetPaths,
  msiDownloadUrl,
  msiSupportFiles,
  productVersion,
  updateTarget,
} from "./packaging.mjs";

function base64Value(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) {
    throw new Error(`${label} must be a nonempty base64 value.`);
  }
  return value.trim();
}

/** Build children need no private signing material. */
export function msiBuildEnvironment(environment = process.env) {
  const result = { ...environment };
  delete result.TAURI_SIGNING_PRIVATE_KEY;
  delete result.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  return result;
}

/** Tauri owns key parsing and signing; FrostPi requires the documented inputs. */
export function msiSigningConfiguration(environment = process.env) {
  const publicKey = base64Value(environment.FROSTPI_UPDATE_PUBLIC_KEY, "FROSTPI_UPDATE_PUBLIC_KEY");
  if (typeof environment.TAURI_SIGNING_PRIVATE_KEY !== "string" || !environment.TAURI_SIGNING_PRIVATE_KEY.trim()) {
    throw new Error("Missing TAURI_SIGNING_PRIVATE_KEY: set the updater signing key in the environment.");
  }
  return { publicKey, environment: { ...environment } };
}

/** The same override embeds the public key during compilation and bundles support files. */
export function msiBuildOverride(publicKey) {
  return {
    bundle: {
      active: true,
      targets: ["msi"],
      // Sign the final installer explicitly with --app-version.
      createUpdaterArtifacts: false,
      resources: Object.fromEntries(msiSupportFiles.map((file) => [`../dist/msi/${file}`, file])),
    },
    plugins: { updater: { pubkey: publicKey } },
  };
}

export function createMsiUpdateManifest({ version = productVersion(), signature }) {
  return {
    version,
    platforms: {
      [updateTarget]: {
        url: msiDownloadUrl(version),
        signature: base64Value(signature, "The MSI update signature"),
      },
    },
  };
}

/** Publish only after the MSI and signature exist; never expose a partial JSON file. */
export function finalizeMsiArtifacts({ version = productVersion(), paths = msiAssetPaths(version) } = {}) {
  if (!statSync(paths.msi).isFile() || statSync(paths.msi).size === 0) {
    throw new Error(`Empty or invalid MSI installer: ${paths.msi}`);
  }
  const signature = readFileSync(paths.signature, "utf8");
  const manifest = createMsiUpdateManifest({ version, signature });
  const temporary = `${paths.manifest}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, paths.manifest);
  return paths;
}

/** Check publication inputs, not provenance, cryptography or installation acceptance. */
export function validateMsiRelease({ tag, version = productVersion(), artifactRoot = artifactsRoot } = {}) {
  if (tag !== `v${version}`) throw new Error("Release tag does not match the Desktop MSI version.");
  const paths = msiAssetPaths(version, artifactRoot);
  if (!statSync(paths.msi).isFile() || statSync(paths.msi).size === 0) {
    throw new Error(`Empty or invalid MSI installer: ${paths.msi}`);
  }
  const signature = base64Value(readFileSync(paths.signature, "utf8"), "The MSI update signature");
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  const platform = manifest.platforms?.[updateTarget];
  if (manifest.version !== version || platform?.url !== msiDownloadUrl(version) || platform?.signature !== signature) {
    throw new Error("The update manifest does not match the MSI version, URL, target or signature.");
  }
  return paths;
}
