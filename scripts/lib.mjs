import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    // Windows pnpm.cmd needs a shell; Node must retain paths/arguments with spaces.
    shell: process.platform === "win32" && command !== process.execPath,
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout ?? "";
}

export function assertNoArguments(usage, args = process.argv.slice(2)) {
  if (args.length > 0) throw new Error(`Usage: ${usage}`);
}

export function projectVersion() {
  return JSON.parse(readFileSync(resolve(root, "apps/vscode/package.json"), "utf8")).version;
}

export function ensureArtifacts() {
  const path = resolve(root, "artifacts");
  mkdirSync(path, { recursive: true });
  return path;
}
