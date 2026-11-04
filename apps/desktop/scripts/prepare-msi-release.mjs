import { validateMsiRelease } from "./msi-contract.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0]) {
  throw new Error("Usage: node apps/desktop/scripts/prepare-msi-release.mjs <tag>");
}
const assets = validateMsiRelease({ tag: args[0] });
console.log(`Prepared Desktop MSI release assets (not installation verification): ${assets.msi}`);
