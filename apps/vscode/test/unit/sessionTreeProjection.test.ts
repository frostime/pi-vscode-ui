import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import {
  buildSessionTreeIndex,
  projectActiveBranchEdges,
  projectBranchEndChoices,
  projectEditableTarget,
} from "../../src/extension/sessions/tree/sessionTreeProjection.js";
import { SessionEntryState } from "../../src/extension/sessions/SessionEntryState.js";

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

  it("uses bounded type and id labels when a branch end has no displayable content", () => {
    const metadata: RpcSessionEntry = {
      type: "model_change",
      id: "123456789",
      parentId: null,
      timestamp: new Date(1).toISOString(),
    };
    const index = buildSessionTreeIndex([metadata], metadata.id);

    expect(projectBranchEndChoices(index, null)[0]).toMatchObject({
      label: "model_change · 12345678",
      detail: "Ends with model_change: model_change · 12345678",
    });
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
