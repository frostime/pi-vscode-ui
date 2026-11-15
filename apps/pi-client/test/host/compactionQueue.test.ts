import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SessionViewModel } from "../../src/shared/model/sessionViewModel.js";
import { queuedRecoveryHost, waitForRecovery } from "../fixtures/queuedRecoveryHost.js";

function userPrompts(session: SessionViewModel | null): string[] {
  return (session?.conversationItems ?? []).flatMap((item) => item.type === "turn" && item.userMessage
    ? [item.userMessage.blocks.map((block) => block.type === "text" ? block.text : "").join("")]
    : []);
}

function pending(session: SessionViewModel | null): string[] {
  return [...session?.queuedSteers ?? [], ...session?.queuedFollowUps ?? []].map((prompt) => prompt.text);
}

describe("prompts sent while Pi compacts the context", () => {
  const fixtures: Awaited<ReturnType<typeof queuedRecoveryHost>>[] = [];
  afterEach(async () => { await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose())); });

  async function host() {
    const fixture = await queuedRecoveryHost("pi", (dir) => [
      "--recovery-compact-release", join(dir, "compact"),
      "--recovery-release", join(dir, "release"),
    ]);
    fixtures.push(fixture);
    const view = () => fixture.registry.sessionView(fixture.sessionId);
    await waitForRecovery(() => view()?.status === "ready");
    return { ...fixture, view, release: (name: "compact" | "release") => writeFile(join(fixture.directory, name), "1") };
  }

  it("answers /compact from the Composer once compaction starts, so the next message can be sent", async () => {
    const fixture = await host();
    const { sessionId, view, release } = fixture;
    const surface = fixture.presentation();
    surface.send({ type: "ready" });
    const result = (requestId: string) => surface.messages.find((message) => message.type === "promptResult" && message.requestId === requestId);
    const send = (requestId: string, text: string, draftRevision: number) =>
      surface.send({ type: "sendPrompt", requestId, sessionId, text, images: [], draftRevision, streamingBehavior: "followUp" });

    send("compact", "/compact", 1);
    await waitForRecovery(() => result("compact") !== undefined);
    // The Composer's request is answered while Pi is still compacting.
    expect(view()?.isCompacting).toBe(true);
    expect(result("compact")).toMatchObject({ ok: true });

    send("next", "after compaction", 2);
    await waitForRecovery(() => result("next") !== undefined);
    expect(result("next")).toMatchObject({ ok: true });
    expect(pending(view())).toEqual(["after compaction"]);

    await release("compact");
    await release("release");
    await waitForRecovery(() => view()?.isStreaming === false && userPrompts(view()).length === 1);
    expect(userPrompts(view())).toEqual(["after compaction"]);
    expect(fixture.errors).toEqual([]);
  });

  it("holds prompts through a manual compaction, which Pi refuses, and sends them in order when it ends", async () => {
    const { registry, sessionId, view, release, errors } = await host();
    const compact = registry.sendPrompt(sessionId, "/compact", []);
    await waitForRecovery(() => view()?.isCompacting === true);

    await registry.sendPrompt(sessionId, "first", [], "followUp");
    await registry.sendPrompt(sessionId, "second", [], "steer");
    // Accepted at once and shown as pending; Pi has not seen them.
    expect(pending(view()).sort()).toEqual(["first", "second"]);
    expect(userPrompts(view())).toEqual([]);

    await release("compact");
    await compact;
    // The first starts a run and the second joins it.
    await waitForRecovery(() => userPrompts(view()).length === 1 && pending(view()).length === 1);
    expect(userPrompts(view())).toEqual(["first"]);
    expect(pending(view())).toEqual(["second"]);

    await release("release");
    await waitForRecovery(() => view()?.isStreaming === false && userPrompts(view()).length === 2);
    expect(userPrompts(view())).toEqual(["first", "second"]);
    expect(pending(view())).toEqual([]);
    expect(view()?.conversationItems.filter((item) => item.type === "notice" && item.level === "error")).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("queues a prompt in Pi during an automatic compaction inside a run", async () => {
    const { registry, sessionId, view, release, errors } = await host();
    await registry.sendPrompt(sessionId, "auto-compact", []);
    await waitForRecovery(() => view()?.isCompacting === true);

    await registry.sendPrompt(sessionId, "steer me", [], "steer");
    expect(pending(view())).toEqual(["steer me"]);

    await release("compact");
    await release("release");
    await waitForRecovery(() => view()?.isStreaming === false && userPrompts(view()).length === 2);
    expect(userPrompts(view())).toEqual(["auto-compact", "steer me"]);
    expect(errors).toEqual([]);
  });

  it("drops the held prompts when the user stops the compaction, as Stop does with a queue", async () => {
    const { registry, sessionId, view, release } = await host();
    const compact = registry.sendPrompt(sessionId, "/compact", []);
    await waitForRecovery(() => view()?.isCompacting === true);
    await registry.sendPrompt(sessionId, "never sent", []);

    await registry.abort(sessionId);
    expect(pending(view())).toEqual([]);
    await release("compact");
    await compact;
    await waitForRecovery(() => view()?.isCompacting === false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(userPrompts(view())).toEqual([]);
    expect(pending(view())).toEqual([]);
  });

  it("still refuses a FrostPi command during compaction, since it would act at once", async () => {
    const { registry, sessionId, view, release } = await host();
    const compact = registry.sendPrompt(sessionId, "/compact", []);
    await waitForRecovery(() => view()?.isCompacting === true);
    await expect(registry.sendPrompt(sessionId, "/compact", [])).rejects.toThrow("Wait for context compaction to finish");
    await release("compact");
    await compact;
  });
});
