import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PiRpcApi, PiRpcConnection } from "@frostime/pi-rpc";
import { expect, it, vi } from "vitest";

it("keeps controlled Pi state snapshots consistent with streaming and Abort events", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-controlled-state-"));
  const connection = new PiRpcConnection({
    cwd: directory,
    command: process.execPath,
    commandArgs: [fileURLToPath(new URL("../fixtures/fake-pi.cjs", import.meta.url))],
    args: ["--stream-084-release", join(directory, "release")],
  });
  const api = new PiRpcApi(connection);
  let started = false;
  connection.onEvent((event) => { if (event.type === "agent_start") started = true; });
  try {
    await connection.start();
    await api.prompt("stream-084");
    await vi.waitFor(() => expect(started).toBe(true));
    expect((await api.getState()).isStreaming).toBe(true);
    await api.abort();
    expect((await api.getState()).isStreaming).toBe(false);
  } finally {
    await connection.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
