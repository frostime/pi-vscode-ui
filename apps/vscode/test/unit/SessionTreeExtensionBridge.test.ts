import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PiRpcApi, RpcCommandDescriptor } from "@frostime/pi-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionTreeExtensionBridge } from "../../src/extension/sessions/tree/SessionTreeExtensionBridge.js";

const bridges: SessionTreeExtensionBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()));
});

describe("SessionTreeExtensionBridge", () => {
  it("owns launch credentials and discovers the collision-suffixed bundled command by source path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-tree-bridge-test-"));
    const artifactPath = join(directory, "session-tree.js");
    const bridge = new SessionTreeExtensionBridge(artifactPath);
    bridges.push(bridge);
    await bridge.prepare();

    const environment = bridge.launchEnvironment();
    const commands: RpcCommandDescriptor[] = [
      command("frostpi.session-tree", join(directory, "user-extension.js")),
      command("frostpi.session-tree:1", artifactPath),
      command("visible", join(directory, "visible.js")),
    ];

    expect(bridge.launchArguments()).toEqual(["-e", artifactPath]);
    expect(environment.FROSTPI_SESSION_TREE_TOKEN).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(environment.FROSTPI_SESSION_TREE_RESULT_DIR).toContain("frostpi-session-tree-");
    expect(bridge.discover(commands).map((item) => item.name)).toEqual(["frostpi.session-tree", "visible"]);
    expect(bridge.available).toBe(true);
    expect(bridge.commandName).toBe("frostpi.session-tree:1");
  });

  it("invokes the discovered command and validates correlated bounded metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-tree-bridge-test-"));
    const artifactPath = join(directory, "session-tree.js");
    const bridge = new SessionTreeExtensionBridge(artifactPath);
    bridges.push(bridge);
    await bridge.prepare();
    const environment = bridge.launchEnvironment();
    bridge.discover([command("frostpi.session-tree:2", artifactPath)]);

    const executeExtensionCommand = vi.fn(async (name: string, encoded: string) => {
      const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
        token: string;
        requestId: string;
        targetId: string;
        summarize: boolean;
      };
      expect(name).toBe("frostpi.session-tree:2");
      expect(request).toMatchObject({
        token: environment.FROSTPI_SESSION_TREE_TOKEN,
        targetId: "entry-1",
        summarize: false,
      });
      await writeFile(
        join(environment.FROSTPI_SESSION_TREE_RESULT_DIR!, `${request.requestId}.json`),
        JSON.stringify({ version: 1, requestId: request.requestId, status: "committed", leafId: "entry-1" }),
      );
    });

    await expect(bridge.navigate({ executeExtensionCommand } as unknown as PiRpcApi, "entry-1", { summarize: false }))
      .resolves.toEqual({ status: "committed", leafId: "entry-1" });
    expect(executeExtensionCommand).toHaveBeenCalledOnce();
  });

  it("rejects uncorrelated results and removes its result directory on dispose", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-tree-bridge-test-"));
    const artifactPath = join(directory, "session-tree.js");
    const bridge = new SessionTreeExtensionBridge(artifactPath);
    bridges.push(bridge);
    await bridge.prepare();
    const environment = bridge.launchEnvironment();
    bridge.discover([command("frostpi.session-tree", artifactPath)]);

    const api = {
      executeExtensionCommand: async (_name: string, encoded: string) => {
        const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { requestId: string };
        await writeFile(
          join(environment.FROSTPI_SESSION_TREE_RESULT_DIR!, `${request.requestId}.json`),
          JSON.stringify({ version: 1, requestId: "other-request", status: "committed", leafId: "entry-1" }),
        );
      },
    };

    await expect(bridge.navigate(api as PiRpcApi, "entry-1", { summarize: true }))
      .rejects.toThrow("Invalid session-tree extension result");
    const resultDirectory = environment.FROSTPI_SESSION_TREE_RESULT_DIR!;
    await bridge.dispose();
    await expect(access(resultDirectory)).rejects.toThrow();
  });
});

function command(name: string, path: string): RpcCommandDescriptor {
  return {
    name,
    source: "extension",
    sourceInfo: { path, source: "local", scope: "temporary", origin: "top-level" },
  };
}
