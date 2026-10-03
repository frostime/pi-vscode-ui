import { extname } from "node:path";

import { runtimeCompatibilityProfile, type RuntimeCompatibility } from "./runtimeCompatibility.js";

export interface ConfiguredPiInvocation {
  command?: string;
  commandArgs?: string[];
}

export function configuredPiInvocation(
  executable: string | undefined,
  compatibility: RuntimeCompatibility = "pi",
): ConfiguredPiInvocation {
  if (!executable) executable = runtimeCompatibilityProfile(compatibility).executableFallback;
  if (!executable) return {};
  const extension = extname(executable).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return { command: process.platform === "win32" ? "node.exe" : "node", commandArgs: [executable] };
  }
  return { command: executable };
}
