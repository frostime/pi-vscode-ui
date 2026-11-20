import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";
import type { ExtensionWidgetView, ScheduledTaskView, SubagentRowView, SubagentTarget } from "../../shared/model/extensionUiModel.js";

const snapshotPrefix = "PI_SUBAGENT_ASYNC_JSON:";
const runStates = new Set(["queued", "running", "complete", "failed", "partial", "paused", "stopped", "rejected"]);
// pi-subagents' RPC widget emits at most 32 KiB, with a maximum child depth of three.
const maxSnapshotBytes = 32 * 1024;
const maxChildDepth = 3;
const runIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const stepIdPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function labelText(value: string): string {
  return sanitizeExtensionUiText(value).replace(/[\u202A-\u202E\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
}

// Read only display fields. Tool inputs, host paths and links are never interpreted.
function timestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function runRows(nodes: unknown[], depth: number, parentRunId?: string): SubagentRowView[] {
  const runs = nodes.filter(isRecord).flatMap(node => {
    if (typeof node.label !== "string" || typeof node.state !== "string" || !runStates.has(node.state)) return [];
    const label = labelText(node.label);
    return label ? [{ label, node, state: node.state }] : [];
  });
  const counts = new Map<string, number>();
  for (const { label } of runs) counts.set(label, (counts.get(label) ?? 0) + 1);
  return runs.flatMap(({ label, node, state }) => {
    const id = typeof node.id === "string" ? node.id : "";
    const runId = depth === 0 && runIdPattern.test(id) ? id : parentRunId;
    const children = Array.isArray(node.children) ? node.children as unknown[] : [];
    const step = children[0];
    const singleStep = node.kind === "subagent" && children.length === 1 && isRecord(step) &&
      step.kind === "step" && step.id === "step:0" && step.label === node.label ? step : undefined;
    let target: SubagentTarget | undefined;
    if (runId && depth === 0 && node.kind === "subagent" && (singleStep || children.length === 0)) {
      target = { runId, childId: "step:0" };
    } else if (runId && depth === 1 && node.kind === "step" && stepIdPattern.test(id)) {
      target = { runId, childId: id };
    }
    const startedAt = timestamp(singleStep?.startedAt ?? node.startedAt);
    const endedAt = timestamp(singleStep?.endedAt ?? node.endedAt);
    const row: SubagentRowView = {
      name: runIdPattern.test(id) && (counts.get(label) ?? 0) > 1 ? `${label} (${id.slice(0, 8)})` : label,
      state, depth, ...(target ? { target } : {}), ...(startedAt ? { startedAt } : {}), ...(endedAt ? { endedAt } : {}),
    };
    if (depth >= maxChildDepth) return [row];
    const below = singleStep ? (Array.isArray(singleStep.children) ? singleStep.children : []) : children;
    return [row, ...runRows(below, depth + 1, singleStep ? undefined : runId)];
  });
}

function scheduleWidget(line: string | undefined): Pick<ExtensionWidgetView, "lines" | "scheduledTasks"> {
  const unavailable = { lines: ["Scheduled tasks unavailable"] };
  try {
    const payload: unknown = JSON.parse(line ?? "");
    if (!isRecord(payload) || payload.version !== 1 || !Array.isArray(payload.tasks)) return unavailable;
    const scheduledTasks: ScheduledTaskView[] = [];
    for (const task of payload.tasks) {
      if (!isRecord(task) || typeof task.id !== "string" || typeof task.name !== "string" ||
          typeof task.timing !== "string" || typeof task.state !== "string" ||
          !["Pending", "Paused", "Delivered", "Missed or failed"].includes(task.state)) return unavailable;
      scheduledTasks.push({
        id: labelText(task.id), name: labelText(task.name), state: task.state, timing: labelText(task.timing),
        ...(typeof task.nextRun === "string" ? { nextRun: labelText(task.nextRun) } : {}),
      });
    }
    return { lines: [], scheduledTasks };
  } catch {
    return unavailable;
  }
}

export function projectExtensionWidget(key: string, lines: string[]): Omit<ExtensionWidgetView, "key" | "placement"> | undefined {
  if (key === "psf-scheduled-tasks") return scheduleWidget(lines[0]);
  if (key !== "subagent-async" || !lines[0]?.startsWith(snapshotPrefix)) return { lines: lines.map(sanitizeExtensionUiText) };
  const unavailable = { lines: ["Subagent status unavailable"] };
  const json = lines[0].slice(snapshotPrefix.length);
  if (Buffer.byteLength(json, "utf8") > maxSnapshotBytes) return unavailable;
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(json);
  } catch {
    return unavailable;
  }
  if (!isRecord(snapshot) || snapshot.kind !== "pi-subagents.async-status-snapshot" ||
      snapshot.version !== 1 || !Array.isArray(snapshot.runs)) return unavailable;

  const subagents = runRows(snapshot.runs, 0);
  const rows = subagents.map(({ name, state, depth }) => `${"  ".repeat(depth)}${name} · ${state}`);
  const omitted = snapshot.omitted;
  if (isRecord(omitted) && (omitted.byteLimitExceeded === true ||
      (typeof omitted.runs === "number" && omitted.runs > 0) || (typeof omitted.children === "number" && omitted.children > 0))) {
    rows.push("Additional activity omitted by Pi");
  }
  if (rows.length) return { lines: ["Subagents", ...rows], subagents };
  return snapshot.runs.length ? unavailable : undefined;
}
