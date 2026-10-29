import { parseArgs } from "node:util";

const sharedPackages = ["@frostime/pi-rpc", "@frostime/provider-usage", "@frostime/pi-client"];
const products = {
  vscode: {
    packageName: "frostpi",
    directory: "apps/vscode",
    outputs: ["dist/extension/extension.cjs", "dist/webview/webview.js", "dist/webview/webview.css"],
  },
  desktop: {
    packageName: "@frostime/frostpi-desktop",
    directory: "apps/desktop",
    outputs: ["dist/backend.cjs", "dist/renderer/index.html"],
  },
};

export function productsForScope(scope) {
  if (scope === "all") return Object.values(products);
  if (Object.hasOwn(products, scope)) return [products[scope]];
  throw new Error(`Unknown workspace scope: ${scope}`);
}

export function packagesForScope(scope = "all") {
  return [...sharedPackages, ...productsForScope(scope).map((product) => product.packageName)];
}

export function scopeFromArgs(args, allowedScopes = ["all", ...Object.keys(products)]) {
  const { values, tokens } = parseArgs({
    args,
    options: { scope: { type: "string", default: "all" } },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  if (tokens.filter((token) => token.kind === "option" && token.name === "scope").length > 1) {
    throw new Error("Pass --scope only once");
  }
  if (!allowedScopes.includes(values.scope)) {
    throw new Error(`Expected --scope <${allowedScopes.join("|")}>`);
  }
  return values.scope;
}
