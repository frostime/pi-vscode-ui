import { execFile, spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";

const SESSION_RECORD_PATTERN = '^\\{"type"\\s*:\\s*"(session|session_info)"';
const RIPGREP_PROBE_TIMEOUT_MS = 3_000;
const MAX_EVENT_CHARACTERS = 1024 * 1024;

export const SESSION_HEADER_BYTES: number = 64 * 1024;

export interface ScannedSessionFile {
  cwd: string;
  bytesScanned: number;
  sessionId?: string;
  sessionInfo?: { name: string | undefined };
}

export type SessionFileScanResult =
  | { complete: true; sessions: ReadonlyMap<string, ScannedSessionFile> }
  | { complete: false };

export interface SessionFileScannerDependencies {
  ripgrep?: Promise<string | undefined>;
  spawnRipgrep?: (command: string, args: readonly string[]) => ChildProcess;
}

interface SessionFileAccumulator {
  header?: { offset: number; cwd: string; sessionId?: string };
  latestInfo?: { offset: number; name: string | undefined };
  bytesScanned?: number;
}

const startupRipgrep = discoverRipgrepExecutable();

export async function scanSessionFilesWithRipgrep(
  roots: readonly string[],
  dependencies: SessionFileScannerDependencies = {},
): Promise<SessionFileScanResult> {
  const existingRoots = await existingSessionRoots(roots);
  if (existingRoots.length === 0) return { complete: true, sessions: new Map() };

  const command = await (dependencies.ripgrep ?? startupRipgrep);
  if (!command) return { complete: false };

  const spawnProcess = dependencies.spawnRipgrep ?? ((executable, args) => spawn(executable, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }));

  return runRipgrep(command, buildRipgrepArguments(existingRoots), spawnProcess);
}

async function existingSessionRoots(roots: readonly string[]): Promise<string[]> {
  const existing = await Promise.all(roots.map(async (path) => {
    try {
      return (await stat(path)).isDirectory() ? path : undefined;
    } catch {
      return undefined;
    }
  }));
  return existing.filter((path): path is string => Boolean(path));
}

export function buildRipgrepArguments(roots: readonly string[]): string[] {
  return [
    "--json",
    "--no-config",
    "--no-ignore",
    "--hidden",
    "--text",
    "--glob", "*.jsonl",
    "--regexp", SESSION_RECORD_PATTERN,
    "--",
    ...roots,
  ];
}

export function sessionPathKey(path: string): string {
  const resolved = normalize(resolve(path));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function selectRipgrepExecutable(
  commands: readonly string[],
  probe: (command: string) => Promise<boolean> = probeRipgrepExecutable,
): Promise<string | undefined> {
  for (const command of commands) {
    if (await probe(command)) return command;
  }
  return undefined;
}

async function discoverRipgrepExecutable(): Promise<string | undefined> {
  const executable = process.platform === "win32" ? "rg.exe" : "rg";
  const agentDirectory = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return selectRipgrepExecutable([executable, join(agentDirectory, "bin", executable)]);
}

function probeRipgrepExecutable(command: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    execFile(command, ["--version"], {
      timeout: RIPGREP_PROBE_TIMEOUT_MS,
      windowsHide: true,
    }, (error) => resolvePromise(!error));
  });
}

function runRipgrep(
  command: string,
  args: readonly string[],
  spawnProcess: (command: string, args: readonly string[]) => ChildProcess,
): Promise<SessionFileScanResult> {
  return new Promise((resolvePromise) => {
    let child: ChildProcess;
    try {
      child = spawnProcess(command, args);
    } catch {
      resolvePromise({ complete: false });
      return;
    }
    const accumulators = new Map<string, SessionFileAccumulator>();
    let stdoutBuffer = "";
    let discardingOversizedEvent = false;
    let protocolValid = true;
    let settled = false;

    const finish = (result: SessionFileScanResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };

    const fail = (): void => {
      child.kill("SIGKILL");
      finish({ complete: false });
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (discardingOversizedEvent) {
        const newline = chunk.indexOf("\n");
        if (newline < 0) return;
        discardingOversizedEvent = false;
        chunk = chunk.slice(newline + 1);
      }
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.length > MAX_EVENT_CHARACTERS || (line && !applyRipgrepEvent(line, accumulators))) protocolValid = false;
        newline = stdoutBuffer.indexOf("\n");
      }
      if (stdoutBuffer.length > MAX_EVENT_CHARACTERS) {
        stdoutBuffer = "";
        discardingOversizedEvent = true;
        protocolValid = false;
      }
    });
    child.stdout?.on("error", fail);
    // Drain stderr so a verbose filesystem error cannot block the child. Session paths are not logged.
    child.stderr?.on("error", fail);
    child.stderr?.resume();
    child.on("error", () => finish({ complete: false }));
    child.on("close", (code) => {
      if (discardingOversizedEvent) protocolValid = false;
      if (stdoutBuffer.trim() && !applyRipgrepEvent(stdoutBuffer, accumulators)) protocolValid = false;
      if (!protocolValid || (code !== 0 && code !== 1)) {
        finish({ complete: false });
        return;
      }
      finish({ complete: true, sessions: completedSessions(accumulators) });
    });
  });
}

function applyRipgrepEvent(raw: string, accumulators: Map<string, SessionFileAccumulator>): boolean {
  let event: unknown;
  try {
    event = JSON.parse(raw) as unknown;
  } catch {
    return false;
  }

  const eventRecord = record(event);
  const data = record(eventRecord?.data);
  if (eventRecord?.type === "end") {
    const path = textValue(record(data?.path));
    const bytesScanned = record(data?.stats)?.bytes_searched;
    if (!path || typeof bytesScanned !== "number") return false;
    const key = sessionPathKey(path);
    const accumulator = accumulators.get(key) ?? {};
    accumulator.bytesScanned = bytesScanned;
    accumulators.set(key, accumulator);
    return true;
  }
  if (eventRecord?.type !== "match") return true;

  const path = textValue(record(data?.path));
  const line = textValue(record(data?.lines));
  const offset = data?.absolute_offset;
  if (!path || line === undefined || typeof offset !== "number") return false;

  let entry: Record<string, unknown>;
  try {
    const parsed = JSON.parse(line) as unknown;
    const parsedRecord = record(parsed);
    if (!parsedRecord) return true;
    entry = parsedRecord;
  } catch {
    // rg matched a truncated JSONL record; it is not usable session metadata.
    return true;
  }

  const key = sessionPathKey(path);
  const accumulator = accumulators.get(key) ?? {};
  if (
    entry.type === "session"
    && typeof entry.cwd === "string"
    && offset + Buffer.byteLength(line, "utf8") <= SESSION_HEADER_BYTES
    && (!accumulator.header || offset < accumulator.header.offset)
  ) {
    accumulator.header = {
      offset,
      cwd: entry.cwd,
      ...(typeof entry.id === "string" ? { sessionId: entry.id } : {}),
    };
  } else if (entry.type === "session_info") {
    const rawName = entry.name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : undefined;
    if (!accumulator.latestInfo || offset >= accumulator.latestInfo.offset) {
      accumulator.latestInfo = { offset, name };
    }
  }
  accumulators.set(key, accumulator);
  return true;
}

function completedSessions(accumulators: ReadonlyMap<string, SessionFileAccumulator>): ReadonlyMap<string, ScannedSessionFile> {
  const sessions = new Map<string, ScannedSessionFile>();
  for (const [path, accumulator] of accumulators) {
    if (!accumulator.header || accumulator.bytesScanned === undefined) continue;
    sessions.set(path, {
      cwd: accumulator.header.cwd,
      bytesScanned: accumulator.bytesScanned,
      ...(accumulator.header.sessionId !== undefined ? { sessionId: accumulator.header.sessionId } : {}),
      ...(accumulator.latestInfo ? { sessionInfo: { name: accumulator.latestInfo.name } } : {}),
    });
  }
  return sessions;
}

function textValue(value: Record<string, unknown> | undefined): string | undefined {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.bytes === "string") return Buffer.from(value.bytes, "base64").toString("utf8");
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
