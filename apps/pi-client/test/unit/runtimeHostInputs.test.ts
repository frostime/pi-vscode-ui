import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import type { FrostPiConfiguration } from "../../src/core/configuration/configurationTypes.js";
import type { ProxyCredentials } from "../../src/core/network/proxyCredentials.js";
import { SessionRuntime } from "../../src/core/sessions/SessionRuntime.js";

it("applies current host proxy and credentials only at launch while preserving client identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-host-inputs-"));
  const executable = join(directory, "fake-pi.cjs");
  const environmentFile = join(directory, "environment.json");
  await writeFile(executable, String.raw`
const fs = require("node:fs");
fs.writeFileSync(process.argv.find(value => value.endsWith("environment.json")), JSON.stringify({
  proxy: process.env.HTTP_PROXY,
  inside: process.env.PI_INSIDE_FROSTPI,
  version: process.env.PI_INSIDE_FROSTPI_VERSION,
}));
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  while (input.includes("\n")) {
    const index = input.indexOf("\n");
    const command = JSON.parse(input.slice(0, index));
    input = input.slice(index + 1);
    const response = { type: "response", id: command.id, success: true };
    if (command.type === "get_state") response.data = { model: null, thinkingLevel: "off", isStreaming: false, isCompacting: false, sessionId: "test" };
    else if (command.type === "get_available_models") response.data = { models: [] };
    else if (command.type === "get_commands") response.data = { commands: [] };
    else if (command.type === "get_entries") response.data = { entries: [], leafId: null };
    process.stdout.write(JSON.stringify(response) + "\n");
    if (command.type === "prompt") process.stdout.write(JSON.stringify({ type: "agent_start" }) + "\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
  const configuration: FrostPiConfiguration = {
    piExecutable: executable,
    piArguments: [environmentFile],
    runtimeCompatibility: "pi",
    startSessionOnOpen: false,
    streamingBehavior: "followUp",
    collapseTurnTrace: true,
    questionToolEnabled: false,
    maxImageBytes: 10 * 1024 * 1024,
    diagnosticsLevel: "error",
    experimentalNotificationsEnabled: false,
    proxy: { mode: "vscode" },
    fileMentionRespectSearchExclude: true,
    fileMentionRespectIgnoreFiles: true,
    fileMentionFollowSymlinks: true,
  };
  let hostProxy = "http://first.invalid:8000";
  let credentials: ProxyCredentials = { username: "fixture", password: "first" };
  const runtime = new SessionRuntime("host-inputs", directory, "Host inputs", () => configuration,
    { get: () => Promise.resolve(credentials) },
    { error: vi.fn(), info: vi.fn() },
    { onChange: vi.fn(), onEditorText: vi.fn() },
    { clientVersion: "test-version", readHostProxy: () => hostProxy },
  );
  const readEnvironment = async () => JSON.parse(await readFile(environmentFile, "utf8")) as { proxy: string; inside: string; version: string };
  try {
    // The provider must remain live after construction, not capture the first value.
    hostProxy = "http://second.invalid:8000";
    await runtime.start();
    expect(await readEnvironment()).toEqual({ proxy: "http://fixture:first@second.invalid:8000/", inside: "1", version: "test-version" });
    await runtime.sendPrompt("hold", []);
    await vi.waitFor(() => expect(runtime.view.status).toBe("running"));
    runtime.refreshConfigurationState();
    expect(runtime.view.networkProxy.restartRequired).toBe(false);

    hostProxy = "http://third.invalid:9000";
    runtime.refreshConfigurationState();
    expect(runtime.view.status).toBe("running");
    expect(runtime.view.networkProxy.restartRequired).toBe(true);
    expect((await readEnvironment()).proxy).toBe("http://fixture:first@second.invalid:8000/");

    credentials = { username: "fixture", password: "second" };
    await runtime.stop();
    await runtime.start();
    expect(await readEnvironment()).toEqual({ proxy: "http://fixture:second@third.invalid:9000/", inside: "1", version: "test-version" });
    expect(runtime.view.networkProxy.restartRequired).toBe(false);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
