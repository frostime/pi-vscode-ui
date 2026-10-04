import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { PiRpcApi } from "../src/PiRpcApi.js";
import { PiRpcConnection } from "../src/PiRpcConnection.js";
import { ohMyPiRpcDialect } from "../src/dialects/ohMyPi/ohMyPiRpcDialect.js";

it("discovers OMP commands over the wire and observes prompt ids before terminal events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "frostpi-omp-commands-"));
  const fixture = join(dir, "omp.cjs");
  await writeFile(fixture, String.raw`
const write = frame => process.stdout.write(JSON.stringify(frame) + "\n");
const commands = [{ name: "review", source: "file" }, { name: "skill:test", source: "skill" }, { name: "ui", source: "extension" }];
write({ type: "ready", supportedProtocolVersions: [1] });
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, command: command.type, success: true };
    if (command.type === "get_state") response.data = { model: null, isStreaming: false };
    else if (command.type === "get_available_commands") {
      response.data = { commands };
      write({ type: "available_commands_update", commands });
    } else if (command.type === "prompt") {
      write({ type: "prompt_result", id: command.id, agentInvoked: false, status: "error", sessionSettled: true });
      response.data = { received: command };
    } else { response.success = false; response.error = "Unknown command: " + command.type; }
    write(response);
  }
});
`);
  const connection = new PiRpcConnection({
    cwd: dir, command: process.execPath, commandArgs: [fixture], dialect: ohMyPiRpcDialect,
    startupTimeoutMs: 2_000, stopTimeoutMs: 100,
  });
  const api = new PiRpcApi(connection);
  let observedId: string | undefined;
  let observedIdAtTerminal: string | undefined;
  const events: unknown[] = [];
  connection.onEvent((event) => {
    events.push(event);
    if (event.type === "prompt_result") observedIdAtTerminal = observedId;
  });
  try {
    await connection.start();
    expect(await api.getCommands()).toEqual([
      { name: "review", source: "prompt", runtimeSource: "file" },
      { name: "skill:test", source: "skill", runtimeSource: "skill" },
    ]);
    expect(events).toContainEqual({ type: "commands_changed", commands: await api.getCommands() });
    const ack = await api.prompt("/review args", { onRequestId: (id) => { observedId = id; } }) as unknown as { received: Record<string, unknown> };
    expect(observedId).toBeDefined();
    expect(observedIdAtTerminal).toBe(observedId);
    expect(ack.received).toEqual({ type: "prompt", message: "/review args", id: observedId });
    expect(events).toContainEqual({ type: "prompt_result", id: observedId, agentInvoked: false, status: "error", sessionSettled: true });
  } finally {
    await connection.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
