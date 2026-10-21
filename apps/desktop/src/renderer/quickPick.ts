import type { DesktopDialog } from "../shared/desktopBridge.js";
import { vscodeLabelText } from "./vscodeLabel.js";

type PickDialog = Extract<DesktopDialog, { kind: "pick" }>;

export function quickPickMatches(item: PickDialog["items"][number], query: string, options: Pick<PickDialog, "matchOnDescription" | "matchOnDetail">): boolean {
  if (item.separator || item.alwaysShow) return true;
  const fields = [item.label];
  if (options.matchOnDescription && item.description) fields.push(item.description);
  if (options.matchOnDetail && item.detail) fields.push(item.detail);
  return fields.map(vscodeLabelText).join(" ").toLowerCase().includes(query.toLowerCase());
}
