import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PiRpcConnection } from "../src/PiRpcConnection.js";
import { ohMyPiRpcDialect } from "../src/dialects/ohMyPi/ohMyPiRpcDialect.js";

let fixtureDir = "";
let fixturePath = "";

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "frostpi-rpc-test-"));
  fixturePath = join(fixtureDir, "fake-pi.mjs");
  await writeFile(
    fixturePath,
    `
let buffer = "";
const isOmp = process.argv.includes("--fake-omp");
const v1Only = process.argv.includes("--v1-only") || process.argv.includes("--no-v2-advertisement");
const negotiationFails = process.argv.includes("--fail-negotiation");
let negotiated = false;
if (isOmp && !process.argv.includes("--no-ready")) {
  send({
    type: "ready",
    protocolVersion: 1,
    ...(process.argv.includes("--no-v2-advertisement") ? {} : { supportedProtocolVersions: v1Only ? [1] : [1, 2] }),
    maxFrameBytes: 1048576,
    ...(v1Only ? {} : { maxReassembledFrameBytes: 67108864 }),
  });
}
function send(value, split = false) {
  const line = JSON.stringify(value) + "\\n";
  if (!split) return void process.stdout.write(line);
  process.stdout.write(line.slice(0, 7));
  setTimeout(() => process.stdout.write(line.slice(7)), 1);
}
function sendChunked(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  const chunkBytes = 256 * 1024;
  const count = Math.ceil(bytes.byteLength / chunkBytes);
  let encoded = "";
  for (let index = 0; index < count; index += 1) {
    encoded += JSON.stringify({
      type: "rpc_chunk",
      chunkId: "rpc-test",
      index,
      count,
      byteLength: bytes.byteLength,
      data: bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64"),
    }) + "\\n";
  }
  process.stdout.write(encoded.slice(0, 7));
  setTimeout(() => process.stdout.write(encoded.slice(7)), 1);
}
function handle(command) {
  if (command.type === "negotiate_protocol") {
    if (v1Only || negotiationFails) {
      send({ type: "response", id: command.id, command: command.type, success: false, error: "Protocol negotiation unavailable" });
      return;
    }
    negotiated = true;
    send({ type: "response", id: command.id, command: command.type, success: true, data: { protocolVersion: 2 } });
    return;
  }
  if (command.type === "get_state") {
    if (isOmp && !v1Only && !negotiated) {
      send({ type: "response", id: command.id, command: command.type, success: false, error: "protocol v2 required before get_state" });
      return;
    }
    send({ type: "response", id: command.id, success: true, data: {
      model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false,
      steeringMode: "one-at-a-time", followUpMode: "one-at-a-time",
      autoCompactionEnabled: true, messageCount: 0, pendingMessageCount: 0,
      sessionName: "a\\u2028b"
    }}, true);
    return;
  }
  if (command.type === "get_entries") {
    send({ type: "response", id: command.id, success: true, data: { entries: [], leafId: null } });
    return;
  }
  if (command.type === "chunked") {
    if (!negotiated) {
      send({ type: "response", id: command.id, success: false, error: "RPC response exceeded the transport limit" });
      return;
    }
    sendChunked({ type: "response", id: command.id, command: command.type, success: true, data: { text: "x".repeat(1048576) } });
    return;
  }
  if (command.type === "prompt") {
    send({ type: "response", id: command.id, success: true });
    send({ type: "agent_start" });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" }});
    send(isOmp ? { type: "session_settled" } : { type: "agent_settled" });
    return;
  }
  if (command.type === "never") return;
  if (command.type === "crash") process.exit(7);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf("\\n");
    if (newline === -1) return;
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
`,
  );
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

function createConnection(): PiRpcConnection {
  return new PiRpcConnection({
    cwd: fixtureDir,
    command: process.execPath,
    commandArgs: [fixturePath],
    requestTimeoutMs: 250,
    startupTimeoutMs: 2_000,
    stopTimeoutMs: 100,
  });
}

describe("PiRpcConnection", () => {
  it("performs a real get_state handshake and delivers events", async () => {
    const connection = createConnection();
    const events: string[] = [];
    connection.onEvent((event) => events.push(event.type));

    try {
      const state = await connection.start();
      expect(state.sessionName).toBe("a\u2028b");
      await connection.request({ type: "prompt", message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(["agent_start", "message_update", "agent_settled"]);
    } finally {
      await connection.stop();
    }
  });

  it("negotiates OMP protocol v2 before the initial state request and normalizes settle", async () => {
    const connection = new PiRpcConnection({
      cwd: fixtureDir,
      command: process.execPath,
      commandArgs: [fixturePath, "--fake-omp"],
      dialect: ohMyPiRpcDialect,
      startupTimeoutMs: 2_000,
      stopTimeoutMs: 100,
    });
    const events: string[] = [];
    connection.onEvent((event) => events.push(event.type));

    try {
      await connection.start();
      const chunked = await connection.request<{ text: string }>({ type: "chunked" });
      expect(chunked.text).toHaveLength(1_048_576);
      await connection.request({ type: "prompt", message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(["agent_start", "message_update", "agent_settled"]);
    } finally {
      await connection.stop();
    }
  });
  it.each(["--v1-only", "--no-v2-advertisement"])("keeps OMP v1 usable without v2 negotiation (%s)", async (flag) => {
    const connection = new PiRpcConnection({
      cwd: fixtureDir,
      command: process.execPath,
      commandArgs: [fixturePath, "--fake-omp", flag],
      dialect: ohMyPiRpcDialect,
      startupTimeoutMs: 2_000,
      stopTimeoutMs: 100,
    });
    const events: string[] = [];
    connection.onEvent((event) => events.push(event.type));

    try {
      const state = await connection.start();
      expect(state.sessionName).toBe("a\u2028b");
      expect(await connection.request({ type: "get_entries" })).toEqual({ entries: [], leafId: null });
      await expect(connection.request({ type: "chunked" })).rejects.toThrow("RPC response exceeded the transport limit");
      await connection.request({ type: "prompt", message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(["agent_start", "message_update", "agent_settled"]);
    } finally {
      await connection.stop();
    }
  });

  it("fails startup when advertised v2 negotiation fails rather than falling back to v1", async () => {
    const connection = new PiRpcConnection({
      cwd: fixtureDir,
      command: process.execPath,
      commandArgs: [fixturePath, "--fake-omp", "--fail-negotiation"],
      dialect: ohMyPiRpcDialect,
      startupTimeoutMs: 2_000,
      stopTimeoutMs: 100,
    });

    try {
      await expect(connection.start()).rejects.toThrow("Protocol negotiation unavailable");
      expect(connection.started).toBe(false);
    } finally {
      await connection.stop();
    }
  });

  it("passes the resolved invocation to an injected launcher", async () => {
    let launchArgs: readonly string[] = [];
    const connection = new PiRpcConnection({
      cwd: fixtureDir,
      command: process.execPath,
      commandArgs: [fixturePath],
      args: ["--no-session"],
      launcher(spec) {
        launchArgs = spec.args;
        return spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"] });
      },
      startupTimeoutMs: 2_000,
      stopTimeoutMs: 100,
    });

    try {
      await connection.start();
      expect(launchArgs.slice(-3)).toEqual(["--mode", "rpc", "--no-session"]);
    } finally {
      await connection.stop();
    }
  });

  it("rejects timed-out requests without corrupting later correlation", async () => {
    const connection = createConnection();
    try {
      await connection.start();
      await expect(connection.request({ type: "never" }, 20)).rejects.toThrow(/Timed out/);
      const state = await connection.request<{ sessionName: string }>({ type: "get_state" });
      expect(state.sessionName).toBe("a\u2028b");
    } finally {
      await connection.stop();
    }
  });

  it("waits without a deadline when the caller explicitly disables the timeout", async () => {
    const connection = createConnection();
    await connection.start();
    const request = connection.request({ type: "never" }, null);
    let settled = false;
    void request.finally(() => { settled = true; }).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    await connection.stop();
    await expect(request).rejects.toThrow(/stopped/);
  });

  it("rejects pending commands when the child exits", async () => {
    const connection = createConnection();
    try {
      await connection.start();
      await expect(connection.request({ type: "crash" }, 2_000)).rejects.toThrow(/exited/);
    } finally {
      await connection.stop();
    }
  });

  it("cancels startup when stopped before the runtime sends ready", async () => {
    let signalSpawned!: () => void;
    const spawned = new Promise<void>((resolve) => { signalSpawned = resolve; });
    const connection = new PiRpcConnection({
      cwd: fixtureDir,
      command: process.execPath,
      commandArgs: [fixturePath, "--fake-omp", "--no-ready"],
      dialect: ohMyPiRpcDialect,
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 100,
      launcher(spec) {
        const child = spawn(spec.command, [...spec.args], { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"] });
        child.once("spawn", signalSpawned);
        return child;
      },
    });
    const failures: Error[] = [];
    connection.onFailure((error) => failures.push(error));
    const startupResult = connection.start().then(
      () => "started",
      (error: Error) => error.message,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await spawned;
      await connection.stop();
      const result = await Promise.race([
        startupResult,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("startup still pending after stop"), 1_000);
        }),
      ]);
      expect(result).toBe("Pi RPC connection stopped");
      expect(connection.started).toBe(false);
      expect(failures).toEqual([]);
    } finally {
      if (timer) clearTimeout(timer);
      await connection.stop();
      await startupResult;
    }
  }, 10_000);

  it("does not emit a failure for caller-requested shutdown", async () => {
    const connection = createConnection();
    const failures: Error[] = [];
    connection.onFailure((error) => failures.push(error));
    await connection.start();
    await connection.stop();
    expect(failures).toEqual([]);
  });
});
