import { render } from "svelte/server";
import { expect, it } from "vitest";
import { ConversationProjection } from "@frostime/pi-client/core/conversation/ConversationProjection";
import { projectExtensionWidget } from "@frostime/pi-client/core/extension-ui/extensionWidgetLines";
import CustomBlock from "$ui/features/conversation/CustomBlock.svelte";
import ExtensionWidgets from "$ui/shell/ExtensionWidgets.svelte";

it("renders scheduler snapshots as task rows and keeps an empty view available", () => {
  const key = "psf-scheduled-tasks";
  const task = { id: "abc", name: "Break", state: "Paused", timing: "Every 5m" };
  for (const tasks of [[], [task]]) {
    const projected = projectExtensionWidget(key, [JSON.stringify({ version: 1, tasks })]);
    if (!projected) throw new Error("Expected scheduler snapshot");
    const widgets = [{ ...projected, key, placement: "above" as const }];
    const html = render(ExtensionWidgets, { props: { widgets } }).body;
    expect(html).toContain(`Scheduled tasks (${tasks.length})`);
    for (const expected of tasks.length ? Object.values(task) : ["No tasks scheduled in this chat."]) {
      expect(html).toContain(expected);
    }
  }
  expect(projectExtensionWidget(key, ["private-invalid-payload"])).toEqual({ lines: ["Scheduled tasks unavailable"] });
});

it("renders the delivered task name from an empty-content Pi message", () => {
  const projection = new ConversationProjection();
  projection.applyEvent({
    type: "message_end",
    message: { role: "custom", customType: "scheduled_prompt", content: [], display: true,
      details: { jobName: "Tea break", prompt: "separately delivered" }, timestamp: 1 },
  });
  const message = projection.read().items.find(item => item.type === "customMessage");
  if (!message || message.type !== "customMessage") throw new Error("Expected a custom message");
  const html = render(CustomBlock, { props: { message } }).body;
  expect(html).toContain("Scheduled prompt delivered: Tea break");
  expect(html).not.toContain("separately delivered");
});
