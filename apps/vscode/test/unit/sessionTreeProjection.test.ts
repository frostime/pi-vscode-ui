import type { RpcSessionEntry } from "@frostime/pi-rpc";
import { describe, expect, it } from "vitest";

import type { BranchSummaryView } from "../../src/shared/model/conversationModel.js";
import {
  buildSessionTreeIndex,
  compactSessionTreeEntries,
  projectBranchEndChoices,
  projectBranchPointControls,
  projectEditableTarget,
} from "../../src/extension/session-tree/sessionTreeProjection.js";

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
  it("removes message content and image bytes from the retained compact index", () => {
    const compact = compactSessionTreeEntries([{
      type: "message",
      id: "image-entry",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: [{ type: "image", data: "secret-bytes", mimeType: "image/png" }] },
    }]);

    expect(compact).toEqual([{
      type: "message",
      id: "image-entry",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user" },
    }]);
  });

  it("derives the active path and reachable branch ends without using text as identity", () => {
    const index = buildSessionTreeIndex(entries, "nested-a-end");

    expect(index.activePath).toEqual(["root", "a", "branch-b", "nested-a", "nested-a-user", "nested-a-end"]);
    expect(projectBranchEndChoices(index, "a").map((choice) => choice.targetId)).toEqual([
      "nested-a-end",
      "nested-b",
      "branch-a-end",
    ]);
    expect(projectBranchEndChoices(index, "a")[0]).toMatchObject({ isCurrent: true, messageCount: 4 });
  });

  it("includes the current non-terminal position and orders other ends newest first", () => {
    const index = buildSessionTreeIndex(entries, "branch-b");
    const choices = projectBranchEndChoices(index, "a");

    expect(choices.map((choice) => [choice.targetId, choice.isCurrent])).toEqual([
      ["branch-b", true],
      ["nested-b", false],
      ["nested-a-end", false],
      ["branch-a-end", false],
    ]);
    const current = choices.find((choice) => choice.targetId === "branch-b");
    expect(current?.isEditable).toBe(true);
    expect(current?.detail).toContain("Opens this prompt in Composer");
  });

  it("anchors nested controls before the nearest active-path user message", () => {
    const index = buildSessionTreeIndex(entries, "nested-a-end");

    expect(projectBranchPointControls(index)).toEqual([
      {
        branchPointId: "a",
        anchorEntryId: "branch-b",
        anchorPosition: "before",
        pathCount: 3,
      },
      {
        branchPointId: "branch-b",
        anchorEntryId: "nested-a-user",
        anchorPosition: "before",
        pathCount: 2,
      },
    ]);
  });

  it("projects user text and images only when an operation asks for the target", () => {
    const target: RpcSessionEntry = {
      type: "message",
      id: "editable",
      parentId: "root",
      timestamp: new Date(10).toISOString(),
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

  it("treats missing parents and parent cycles as separate roots", () => {
    const malformed: RpcSessionEntry[] = [
      entry("orphan", "missing", 1, "assistant", "orphan"),
      entry("cycle-a", "cycle-b", 2, "user", "same"),
      entry("cycle-b", "cycle-a", 3, "assistant", "same"),
      entry("cycle-end", "cycle-b", 4, "assistant", "end"),
    ];
    const index = buildSessionTreeIndex(malformed, "cycle-end");

    expect(index.activePath).toEqual(["cycle-end"]);
    expect(index.childrenById.get(null)).toEqual(["orphan", "cycle-a", "cycle-b", "cycle-end"]);
  });

  it("projects root branches and nested divergence breadcrumbs", () => {
    const rootBranches: RpcSessionEntry[] = [
      entry("root-a", null, 1, "user", "First root"),
      entry("root-a-end", "root-a", 2, "assistant", "First end"),
      entry("root-b", null, 3, "user", "Second root"),
      entry("root-b-split", "root-b", 4, "assistant", "Shared path"),
      entry("root-b-left", "root-b-split", 5, "user", "Left nested"),
      entry("root-b-right", "root-b-split", 6, "user", "Right nested"),
    ];
    const index = buildSessionTreeIndex(rootBranches, "root-b-right");
    const choices = projectBranchEndChoices(index, null);

    expect(choices.map((choice) => choice.targetId)).toEqual(["root-b-right", "root-b-left", "root-a-end"]);
    expect(choices[0]?.label).toBe("Second root › Right nested");
    expect(projectBranchPointControls(index)[0]).toEqual({
      branchPointId: null,
      anchorEntryId: "root-b",
      anchorPosition: "before",
      pathCount: 3,
    });
  });

  it("anchors controls before the nearest user message even when it precedes the branch point", () => {
    const assistantSplit: RpcSessionEntry[] = [
      entry("user-a", null, 1, "user", "Prompt"),
      entry("assistant-split", "user-a", 2, "assistant", "Split"),
      entry("assistant-left", "assistant-split", 3, "assistant", "Left"),
      entry("assistant-right", "assistant-split", 4, "assistant", "Right"),
    ];
    const index = buildSessionTreeIndex(assistantSplit, "assistant-left");

    expect(projectBranchPointControls(index)).toEqual([{
      branchPointId: "assistant-split",
      anchorEntryId: "user-a",
      anchorPosition: "before",
      pathCount: 2,
    }]);
  });

  it("attaches branch summaries to the control for their nearest branching point", () => {
    const index = buildSessionTreeIndex(entries, "nested-a-end");
    const summaries: BranchSummaryView[] = [
      { id: "s1", summary: "From nested branch", fromId: "nested-a-end", timestamp: 10 },
      { id: "s2", summary: "From root branch", fromId: "branch-a-end", timestamp: 11 },
    ];

    const controls = projectBranchPointControls(index, summaries);
    expect(controls.find((c) => c.branchPointId === "branch-b")?.branchSummary).toMatchObject({
      id: "s1",
      summary: "From nested branch",
      fromId: "nested-a-end",
    });
    expect(controls.find((c) => c.branchPointId === "a")?.branchSummary).toMatchObject({
      id: "s2",
      summary: "From root branch",
      fromId: "branch-a-end",
    });
  });

  it("falls back to bounded type and id labels when content is unavailable", () => {
    const metadata: RpcSessionEntry = { type: "tool_call", id: "123456789", parentId: null, timestamp: new Date(1).toISOString() };
    const index = buildSessionTreeIndex([metadata], "123456789");

    expect(projectBranchEndChoices(index, null)[0]).toMatchObject({
      label: "tool_call · 12345678",
      detail: "Ends with tool_call: tool_call · 12345678",
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
