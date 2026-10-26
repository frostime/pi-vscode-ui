import { spawnSync } from "node:child_process";

/**
 * Quotes a value as a PowerShell single-quoted literal. Paths can contain
 * apostrophes (a user name such as `O'Brien`), which must be doubled rather
 * than ending the literal.
 */
export function powerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function runPowerShell(script, { capture = false, timeout = 600_000 } = {}) {
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 500) : "";
    throw new Error(`PowerShell script failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
}
