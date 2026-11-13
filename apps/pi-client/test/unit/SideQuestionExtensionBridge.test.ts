import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PiRpcApi, RpcCommandDescriptor } from "@frostime/pi-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SideQuestionExtensionBridge } from "../../src/core/side-question/SideQuestionExtensionBridge.js";

const bridges: SideQuestionExtensionBridge[] = [];

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.dispose()));
});

function command(name: string, path: string): RpcCommandDescriptor {
  return { name, source: "extension", sourceInfo: { path, source: "local", scope: "temporary", origin: "top-level" } };
}

async function preparedBridge(commandName = "frostpi.side-question") {
  const directory = await mkdtemp(join(tmpdir(), "frostpi-side-bridge-test-"));
  const artifactPath = join(directory, "side-question.js");
  const bridge = new SideQuestionExtensionBridge(artifactPath);
  bridges.push(bridge);
  await bridge.prepare();
  const environment = bridge.launchEnvironment();
  bridge.discover([command(commandName, artifactPath)]);
  const resultDirectory = environment.FROSTPI_SIDE_QUESTION_RESULT_DIR!;
  /** A fake Pi: decodes the private request and writes whatever result the test supplies. */
  const api = (result: (request: { token: string; requestId: string; question: string }) => unknown, fail?: Error) => {
    const executeExtensionCommand = vi.fn(async (_name: string, encoded: string) => {
      const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { token: string; requestId: string; question: string };
      const value = result(request);
      if (value !== undefined) await writeFile(join(resultDirectory, `${request.requestId}.json`), typeof value === "string" ? value : JSON.stringify(value));
      if (fail) throw fail;
    });
    return { api: { executeExtensionCommand } as unknown as PiRpcApi, executeExtensionCommand };
  };
  return { bridge, artifactPath, directory, environment, resultDirectory, api };
}

describe("SideQuestionExtensionBridge", () => {
  it("owns launch credentials and finds the bundled command by source path, not by name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-side-bridge-test-"));
    const artifactPath = join(directory, "side-question.js");
    const bridge = new SideQuestionExtensionBridge(artifactPath);
    bridges.push(bridge);
    expect(() => bridge.launchEnvironment()).toThrow("not prepared");
    await bridge.prepare();

    const environment = bridge.launchEnvironment();
    expect(bridge.launchArguments()).toEqual(["-e", artifactPath]);
    expect(environment.FROSTPI_SIDE_QUESTION_TOKEN).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(environment.FROSTPI_SIDE_QUESTION_RESULT_DIR).toContain("frostpi-side-question-");
    expect(bridge.available).toBe(false);

    const visible = bridge.discover([
      command("frostpi.side-question", join(directory, "user-extension.js")),
      command("frostpi.side-question:1", artifactPath),
      command("visible", join(directory, "visible.js")),
    ]);
    expect(visible.map((item) => item.name)).toEqual(["frostpi.side-question", "visible"]);
    expect(bridge.available).toBe(true);

    // A restarted process has to show the command again before it is used.
    await bridge.prepare();
    expect(bridge.available).toBe(false);
    expect(bridge.launchEnvironment()).toEqual(environment);
  });

  it("sends the question with its token and returns the correlated answer, then removes the result", async () => {
    const { bridge, environment, resultDirectory, api } = await preparedBridge("frostpi.side-question:2");
    const fake = api((request) => ({
      version: 1, requestId: request.requestId, status: "answered", answer: `Echo ${request.question}`,
      model: "anthropic/claude", usage: { input: 10.4, output: 2, cacheRead: -5, cost: 1 },
    }));

    await expect(bridge.ask(fake.api, "What changed?")).resolves.toEqual({
      answer: "Echo What changed?", truncated: false, model: "anthropic/claude", usage: { input: 10, output: 2, cacheRead: 0 },
    });

    const [name, encoded] = fake.executeExtensionCommand.mock.calls[0]!;
    expect(name).toBe("frostpi.side-question:2");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toMatchObject({
      token: environment.FROSTPI_SIDE_QUESTION_TOKEN, question: "What changed?",
    });
    // The answer quotes the conversation; it does not stay on disk.
    expect(await readdir(resultDirectory)).toEqual([]);
  });

  it("surfaces the adapter's failure text and marks a cut answer", async () => {
    const { bridge, api } = await preparedBridge();
    await expect(bridge.ask(api((request) => ({ version: 1, requestId: request.requestId, status: "failed", error: "401 unauthorized" })).api, "q"))
      .rejects.toThrow("401 unauthorized");
    await expect(bridge.ask(api((request) => ({ version: 1, requestId: request.requestId, status: "answered", answer: "a", truncated: true })).api, "q"))
      .resolves.toMatchObject({ answer: "a", truncated: true });
    // Only the two known reasons for a partial answer pass; anything else is dropped.
    await expect(bridge.ask(api((request) => ({ version: 1, requestId: request.requestId, status: "answered", answer: "a", incomplete: "tool-call" })).api, "q"))
      .resolves.toEqual({ answer: "a", truncated: false, incomplete: "tool-call" });
    await expect(bridge.ask(api((request) => ({ version: 1, requestId: request.requestId, status: "answered", answer: "a", incomplete: "<b>other</b>" })).api, "q"))
      .resolves.toEqual({ answer: "a", truncated: false });
  });

  it.each([
    ["an uncorrelated result", (request: { requestId: string }) => ({ version: 1, requestId: `${request.requestId}-other`, status: "answered", answer: "a" })],
    ["an unknown version", (request: { requestId: string }) => ({ version: 2, requestId: request.requestId, status: "answered", answer: "a" })],
    ["an empty answer", (request: { requestId: string }) => ({ version: 1, requestId: request.requestId, status: "answered", answer: "" })],
    ["malformed JSON", () => "{not json"],
  ])("rejects %s and still removes the file", async (_label, result) => {
    const { bridge, resultDirectory, api } = await preparedBridge();
    await expect(bridge.ask(api(result as never).api, "q")).rejects.toThrow();
    expect(await readdir(resultDirectory)).toEqual([]);
  });

  it("explains a missing result and prefers the command's own error when there is one", async () => {
    const { bridge, api } = await preparedBridge();
    await expect(bridge.ask(api(() => undefined).api, "q")).rejects.toThrow("Pi did not return an answer to the side question.");
    await expect(bridge.ask(api(() => undefined, new Error("Pi RPC connection stopped")).api, "q")).rejects.toThrow("Pi RPC connection stopped");
  });

  it("is unavailable until discovered and after disposal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frostpi-side-bridge-test-"));
    const bridge = new SideQuestionExtensionBridge(join(directory, "side-question.js"));
    bridges.push(bridge);
    await bridge.prepare();
    const executeExtensionCommand = vi.fn();
    await expect(bridge.ask({ executeExtensionCommand } as unknown as PiRpcApi, "q")).rejects.toThrow("Side questions are unavailable in this Pi process");
    expect(executeExtensionCommand).not.toHaveBeenCalled();

    const prepared = await preparedBridge();
    await prepared.bridge.dispose();
    expect(prepared.bridge.available).toBe(false);
    await expect(readdir(prepared.resultDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
