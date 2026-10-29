import { parseArgs } from "node:util";

const sharedPackages = ["@frostime/pi-rpc", "@frostime/provider-usage", "@frostime/pi-client"];
const productPackages = { vscode: "frostpi", desktop: "@frostime/frostpi-desktop" };

function productsForScope(scope) {
  if (scope === "all") return Object.values(productPackages);
  if (Object.hasOwn(productPackages, scope)) return [productPackages[scope]];
  throw new Error(`Unknown workspace scope: ${scope}`);
}

export function packagesForScope(scope = "all") {
  return [...sharedPackages, ...productsForScope(scope)];
}

export function buildSteps(scope = "all") {
  // SPEC: The client build prepares both shared engines. Product-local builds must
  // compile only their own outputs here, so a workspace build never rebuilds dependencies.
  return [
    { packageName: "@frostime/pi-client", script: "build" },
    ...productsForScope(scope).map((packageName) => ({ packageName, script: "build:local" })),
  ];
}

export function scopeFromArgs(args, allowedScopes = ["all", "vscode", "desktop"]) {
  const { values, tokens } = parseArgs({
    args,
    options: { scope: { type: "string", default: "all" } },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  if (tokens.filter((token) => token.kind === "option" && token.name === "scope").length > 1) {
    throw new Error("Pass --scope only once; a product entry cannot override its scope");
  }
  if (!allowedScopes.includes(values.scope)) {
    throw new Error(`Expected --scope <${allowedScopes.join("|")}>`);
  }
  return values.scope;
}
