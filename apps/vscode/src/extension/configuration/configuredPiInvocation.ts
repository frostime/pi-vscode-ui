import { extname } from "node:path";

export interface ConfiguredPiInvocation {
  command?: string;
  commandArgs?: string[];
}

export function configuredPiInvocation(executable: string | undefined): ConfiguredPiInvocation {
  if (!executable) return {};
  const extension = extname(executable).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return { command: process.platform === "win32" ? "node.exe" : "node", commandArgs: [executable] };
  }
  return { command: executable };
}
