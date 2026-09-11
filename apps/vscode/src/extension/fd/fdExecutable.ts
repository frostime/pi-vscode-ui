import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export interface FdExecutable {
  command: string;
  version: string;
  supportsDirectoryMarkers: boolean;
}

export function parseFdVersion(command: string, output: string): FdExecutable {
  const match = output.match(/\b(\d+)(?:\.\d+){1,2}\b/);
  const version = match?.[0] ?? "unknown";
  const major = match ? Number.parseInt(match[1] ?? "", 10) : 0;
  return { command, version, supportsDirectoryMarkers: major >= 10 };
}

export async function selectFdExecutable(
  commands: readonly string[],
  probe: (command: string) => Promise<FdExecutable | undefined> = probeFdExecutable,
): Promise<FdExecutable> {
  let legacy: FdExecutable | undefined;
  for (const command of commands) {
    const fd = await probe(command);
    if (!fd) continue;
    if (fd.supportsDirectoryMarkers) return fd;
    legacy ??= fd;
  }
  if (legacy) return legacy;
  throw new Error("fd is required for workspace path completion but was not found in PATH or Pi's managed bin directory.");
}

export async function discoverFdExecutable(): Promise<FdExecutable> {
  const pathCandidates = process.platform === "linux" ? ["fd", "fdfind"] : ["fd"];
  const agentDirectory = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const managed = join(agentDirectory, "bin", process.platform === "win32" ? "fd.exe" : "fd");
  return selectFdExecutable([...new Set([...pathCandidates, managed])]);
}

async function probeFdExecutable(command: string): Promise<FdExecutable | undefined> {
  return new Promise((resolvePromise) => {
    execFile(command, ["--version"], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error) {
        resolvePromise(undefined);
        return;
      }
      resolvePromise(parseFdVersion(command, stdout));
    });
  });
}
