import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";

const snapshotPrefix = "PI_SUBAGENT_ASYNC_JSON:";
const runStates = new Set(["queued", "running", "complete", "failed", "partial", "paused", "stopped", "rejected"]);
// pi-subagents' RPC widget emits at most 32 KiB, with a maximum child depth of three.
const maxSnapshotBytes = 32 * 1024;
const maxChildDepth = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function labelText(value: string): string {
  return sanitizeExtensionUiText(value).replace(/[\u202A-\u202E\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
}

// Read only display fields. Tool inputs, host paths and links are never interpreted.
function runLines(nodes: unknown[], depth: number): string[] {
  const runs = nodes.filter(isRecord).flatMap(node => {
    if (typeof node.label !== "string" || typeof node.state !== "string" || !runStates.has(node.state)) return [];
    const label = labelText(node.label);
    return label ? [{ label, node, state: node.state }] : [];
  });
  const counts = new Map<string, number>();
  for (const { label } of runs) counts.set(label, (counts.get(label) ?? 0) + 1);
  return runs.flatMap(({ label, node, state }) => {
    const id = typeof node.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]+$/iu.test(node.id) ? node.id.slice(0, 8) : "";
    const name = id && (counts.get(label) ?? 0) > 1 ? `${label} (${id})` : label;
    const line = `${"  ".repeat(depth)}${name} · ${state}`;
    if (depth >= maxChildDepth || !Array.isArray(node.children)) return [line];
    const [step] = node.children as unknown[];
    // A single-agent run also emits its own unnamed execution step. The run owns its status.
    if (node.kind === "subagent" && node.children.length === 1 && isRecord(step) &&
        step.kind === "step" && step.id === "step:0" && step.label === node.label) {
      return Array.isArray(step.children) ? [line, ...runLines(step.children, depth + 1)] : [line];
    }
    return [line, ...runLines(node.children, depth + 1)];
  });
}

export function extensionWidgetLines(key: string, lines: string[]): string[] | undefined {
  if (key !== "subagent-async" || !lines[0]?.startsWith(snapshotPrefix)) return lines.map(sanitizeExtensionUiText);
  const unavailable = ["Subagent status unavailable"];
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

  const rows = runLines(snapshot.runs, 0);
  const omitted = snapshot.omitted;
  if (isRecord(omitted) && (omitted.byteLimitExceeded === true ||
      (typeof omitted.runs === "number" && omitted.runs > 0) || (typeof omitted.children === "number" && omitted.children > 0))) {
    rows.push("Additional activity omitted by Pi");
  }
  if (rows.length) return ["Subagents", ...rows];
  return snapshot.runs.length ? unavailable : undefined;
}
