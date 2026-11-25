import { render } from "svelte/server";
import { expect, it } from "vitest";
import { ConversationProjection } from "@frostime/pi-client/core/conversation/ConversationProjection";
import { projectExtensionWidget } from "@frostime/pi-client/core/extension-ui/extensionWidgetLines";
import CustomBlock from "$ui/features/conversation/CustomBlock.svelte";
import ExtensionWidgets from "$ui/shell/ExtensionWidgets.svelte";

it("renders scheduled tasks only when the chat has any", () => {
  const key = "psf-scheduled-tasks";
  const task = { id: "abc", name: "Break", state: "Paused", timing: "Every 5m" };
  expect(projectExtensionWidget(key, [JSON.stringify({ version: 1, tasks: [] })])).toBeUndefined();
  const projected = projectExtensionWidget(key, [JSON.stringify({ version: 1, tasks: [task] })]);
  if (!projected) throw new Error("Expected scheduler snapshot");
  const widgets = [{ ...projected, key, placement: "above" as const }];
  const html = render(ExtensionWidgets, { props: { widgets } }).body;
  expect(html).toContain("Scheduled tasks (1)");
  for (const expected of Object.values(task)) expect(html).toContain(expected);
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
