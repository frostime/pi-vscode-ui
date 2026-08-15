import { describe, expect, it } from "vitest";

import { BRIDGE_VERSION } from "../../src/shared/bridge/bridgeVersion.js";
import { webviewToHostSchema } from "../../src/shared/bridge/webviewToHost.js";

describe("Webview bridge validation", () => {
  it("accepts a correlated image prompt", () => {
    const parsed = webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION, type: "sendPrompt", requestId: "request-1", sessionId: "session-1", text: "inspect",
      images: [{ id: "image-1", name: "shot.png", mimeType: "image/png", data: "AA==", size: 1 }], streamingBehavior: "steer",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects uncorrelated prompt submissions and excessive attachments", () => {
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "sendPrompt", sessionId: "s", text: "x", images: [], streamingBehavior: "followUp" }).success).toBe(false);
    const images = Array.from({ length: 13 }, (_, index) => ({ id: String(index), name: `${index}.png`, mimeType: "image/png", data: "AA==", size: 1 }));
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "sendPrompt", requestId: "r", sessionId: "s", text: "x", images, streamingBehavior: "followUp" }).success).toBe(false);
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "sendPrompt", requestId: "r", sessionId: "s", text: "x", images: [], streamingBehavior: "later" }).success).toBe(false);
  });

  it("accepts local session, history, copy, composer-editor, and correlated message-fork actions", () => {
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "resumeSession" }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "openComposerEditor",
      sessionId: "session-1",
      text: "draft",
    }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "copyText", text: "raw **Markdown**" }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "loadHistory", sessionId: "session-1" }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({ bridgeVersion: BRIDGE_VERSION, type: "cancelFork", sessionId: "session-1" }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "forkMessage",
      requestId: "fork-1",
      sessionId: "session-1",
      entryId: "entry-1",
    }).success).toBe(true);
  });

  it("accepts bounded session-tree actions and rejects malformed fields", () => {
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "branchHere",
      sessionId: "session-1",
      entryId: "entry-1",
      hasDraft: true,
    }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "switchBranch",
      sessionId: "session-1",
      branchPointId: "branch-1",
      hasDraft: false,
    }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "switchBranch",
      sessionId: "session-1",
      branchPointId: null,
      hasDraft: false,
    }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "checkPiIntegration",
      sessionId: "session-1",
    }).success).toBe(true);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "branchHere",
      sessionId: "session-1",
      entryId: "x".repeat(129),
      hasDraft: true,
    }).success).toBe(false);
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "switchBranch",
      sessionId: "session-1",
      branchPointId: "branch-1",
    }).success).toBe(false);
  });

  it("accepts file locations with a line and column", () => {
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "openFile",
      path: "src/file.ts",
      line: 42,
      column: 5,
    }).success).toBe(true);
  });

  it("accepts an ordered file line range", () => {
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "openFile",
      path: "src/file.ts",
      line: 5,
      endLine: 10,
    }).success).toBe(true);
  });

  it.each([
    { column: 5 },
    { endLine: 10 },
    { line: 10, endLine: 5 },
    { line: 5, column: 2, endLine: 10 },
  ])("rejects an invalid file location: $column $line $endLine", (location) => {
    expect(webviewToHostSchema.safeParse({
      bridgeVersion: BRIDGE_VERSION,
      type: "openFile",
      path: "src/file.ts",
      ...location,
    }).success).toBe(false);
  });

  it("rejects incompatible bridge versions", () => {
    expect(webviewToHostSchema.safeParse({ bridgeVersion: "stale-version", type: "ready" }).success).toBe(false);
  });
});
