import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import {
  buildSessionTreeIndex,
  projectActiveBranchEdges,
  projectBranchEndChoices,
  projectEditableTarget,
  projectRewindTargets,
} from "../../src/core/sessions/tree/sessionTreeProjection.js";
import { SessionEntryState } from "../../src/core/sessions/SessionEntryState.js";

const entries: RpcSessionEntry[] = [
  entry("root", null, 1, "user", "Start"),
  entry("a", "root", 2, "assistant", "A answer"),
  entry("branch-a", "a", 3, "user", "Keep parser"),
  entry("branch-a-end", "branch-a", 4, "assistant", "Parser kept"),
  entry("branch-b", "a", 5, "user", "Use library"),
  entry("nested-a", "branch-b", 6, "assistant", "Library answer"),
  entry("nested-a-user", "nested-a", 7, "user", "Try adapter"),
  entry("nested-a-end", "nested-a-user", 8, "assistant", "Adapter works"),
  entry("nested-b", "branch-b", 9, "assistant", "Library alternative"),
];

describe("rewind targets", () => {
  it("lists the user's prompts on the active path, latest first, with what each rewind removes", () => {
    const index = buildSessionTreeIndex(entries, "nested-a-end");

    expect(projectRewindTargets(index)).toEqual([
      { targetId: "nested-a-user", label: "Try adapter", hasImages: false, removedMessageCount: 2, sentAt: 7 },
      { targetId: "branch-b", label: "Use library", hasImages: false, removedMessageCount: 4, sentAt: 5 },
      { targetId: "root", label: "Start", hasImages: false, removedMessageCount: 6, sentAt: 1 },
    ]);
  });

  it("offers only real user prompts and ignores the abandoned branches", () => {
    const path: RpcSessionEntry[] = [
      { type: "model_change", id: "model", parentId: null, timestamp: new Date(1).toISOString(), provider: "p", modelId: "m" },
      entry("system", "model", 2, "system", "System prompt"),
      entry("ask", "system", 3, "user", "  First\n  prompt with   spacing "),
      entry("answer", "ask", 4, "assistant", "Answer"),
      { type: "custom_message", id: "mail", parentId: "answer", timestamp: new Date(5).toISOString(), customType: "pi-mail", content: "Injected", display: true },
      entry("tools-changed", "mail", 5, "system", ""),
      { type: "compaction", id: "compact", parentId: "tools-changed", timestamp: new Date(6).toISOString(), summary: "Summary", firstKeptEntryId: "ask" },
      {
        type: "message", id: "image-ask", parentId: "compact", timestamp: new Date(7).toISOString(),
        message: { role: "user", timestamp: 7, content: [{ type: "text", text: "Look" }, { type: "image", data: "AAAA", mimeType: "image/png" }] },
      },
      entry("abandoned", "answer", 8, "user", "Other path"),
    ];

    expect(projectRewindTargets(buildSessionTreeIndex(path, "image-ask"))).toEqual([
      { targetId: "image-ask", label: "Look", hasImages: true, removedMessageCount: 1, sentAt: 7 },
      // System messages, before or after it, are not conversation steps; the custom message is.
      { targetId: "ask", label: "First prompt with spacing", hasImages: false, removedMessageCount: 4, sentAt: 3 },
    ]);
    expect(projectRewindTargets(buildSessionTreeIndex([], null))).toEqual([]);
  });
});

describe("session tree projection", () => {
  it("projects branch controls from exact active parent-child edges", () => {
    const state = new SessionEntryState();
    const { index } = state.replace(entries, "nested-a-end");

    expect(projectActiveBranchEdges(index)).toEqual([
      { branchPointId: "a", activeChildEntryId: "branch-b", pathCount: 3 },
      { branchPointId: "branch-b", activeChildEntryId: "nested-a", pathCount: 2 },
    ]);
  });

  it("projects a virtual-root edge when the session has multiple roots", () => {
    const rootBranches = [
      entry("root-a", null, 1, "user", "First root"),
      entry("root-a-end", "root-a", 2, "assistant", "First end"),
      entry("root-b", null, 3, "user", "Second root"),
      entry("root-b-end", "root-b", 4, "assistant", "Second end"),
    ];
    const state = new SessionEntryState();
    const { index } = state.replace(rootBranches, "root-b-end");

    expect(projectActiveBranchEdges(index)).toEqual([
      { branchPointId: null, activeChildEntryId: "root-b", pathCount: 2 },
    ]);
  });

  it("derives reachable branch ends without using message text as identity", () => {
    const index = buildSessionTreeIndex(entries, "nested-a-end");

    expect(projectBranchEndChoices(index, "a").map((choice) => choice.targetId)).toEqual([
      "nested-a-end",
      "nested-b",
      "branch-a-end",
    ]);
    expect(projectBranchEndChoices(index, "a")[0]).toMatchObject({ isCurrent: true, messageCount: 4 });
  });

  it("includes a current non-terminal position and orders other ends newest first", () => {
    const index = buildSessionTreeIndex(entries, "branch-b");
    const choices = projectBranchEndChoices(index, "a");

    expect(choices.map((choice) => [choice.targetId, choice.isCurrent])).toEqual([
      ["branch-b", true],
      ["nested-b", false],
      ["nested-a-end", false],
      ["branch-a-end", false],
    ]);
    expect(choices[0]).toMatchObject({ isEditable: true });
  });

  it("projects user text and images only when navigation requests the target", () => {
    const target: RpcSessionEntry = {
      type: "message",
      id: "editable",
      parentId: "root",
      message: {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "image", mimeType: "image/png", data: "AA==", fileName: "shot.png", size: 1 },
          { type: "text", text: "second" },
        ],
        attachments: [{ type: "image", mimeType: "image/jpeg", content: "/w==", fileName: "extra.jpg", size: 1 }],
      },
    };

    expect(projectEditableTarget(target)).toEqual({
      entryId: "editable",
      text: "first\nsecond",
      images: [
        expect.objectContaining({ name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" }),
        expect.objectContaining({ name: "extra.jpg", mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/w==" }),
      ],
    });
    expect(projectEditableTarget(entries[1]!)).toBeNull();
  });

  it("still offers a branch end that has no displayable content", () => {
    const metadata: RpcSessionEntry = {
      type: "model_change",
      id: "123456789",
      parentId: null,
      timestamp: new Date(1).toISOString(),
    };
    const index = buildSessionTreeIndex([metadata], metadata.id);

    expect(projectBranchEndChoices(index, null)).toMatchObject([{ targetId: metadata.id }]);
  });
});

function entry(
  id: string,
  parentId: string | null,
  timestamp: number,
  role: string,
  text: string,
): RpcSessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content: text, timestamp },
  };
}
