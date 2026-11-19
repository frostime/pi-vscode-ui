import type { BranchEndChoiceProjection } from "../../core/sessions/tree/sessionTreeProjection.js";
import type { SessionTreeSummaryOptions } from "../../core/sessions/tree/SessionTreeExtensionBridge.js";
import type { ClientHost, HostQuickPickItem, HostQuickPickSeparator } from "../clientHost.js";

const SEPARATOR: HostQuickPickSeparator = { label: "", kind: "separator" };

interface BranchQuickPickItem extends HostQuickPickItem {
  choice: BranchEndChoiceProjection;
}

export async function pickBranchEnd(
  host: ClientHost,
  choices: readonly BranchEndChoiceProjection[],
): Promise<BranchEndChoiceProjection | undefined> {
  const current = choices.filter((choice) => choice.isCurrent);
  const alternatives = choices.filter((choice) => !choice.isCurrent);
  const items: Array<BranchQuickPickItem | HostQuickPickSeparator> = [
    ...(current.length ? [separator("Current path"), ...current.map(branchItem)] : []),
    ...(alternatives.length ? [separator("Other paths"), ...alternatives.map(branchItem)] : []),
  ];
  const selected = await host.window.showQuickPick(items, {
    title: "Switch branch",
    placeHolder: "Choose a conversation path",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return selected && "choice" in selected ? selected.choice : undefined;
}

function branchItem(choice: BranchEndChoiceProjection): BranchQuickPickItem {
  const metadata = `${choice.messageCount} ${choice.messageCount === 1 ? "message" : "messages"} · ${updatedLabel(choice.updatedAt)}`;
  return {
    label: `${choice.isCurrent ? "$(check)" : "$(git-branch)"} ${choice.label}`,
    description: metadata,
    detail: `${metadata} · ${choice.detail}`,
    choice,
  };
}

function separator(label: string): HostQuickPickSeparator {
  return { ...SEPARATOR, label };
}

function updatedLabel(updatedAt: number, now = Date.now()): string {
  if (updatedAt <= 0) return "update time unavailable";
  const elapsed = Math.max(0, now - updatedAt);
  if (elapsed < 60_000) return "updated just now";
  if (elapsed < 3_600_000) return `updated ${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `updated ${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `updated ${Math.floor(elapsed / 86_400_000)}d ago`;
  return `updated ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(updatedAt)}`;
}

interface BranchSummaryQuickPickItem extends HostQuickPickItem {
  mode: "none" | "default" | "custom";
}

export async function pickBranchSummary(host: ClientHost): Promise<SessionTreeSummaryOptions | undefined> {
  const selected = await host.window.showQuickPick<BranchSummaryQuickPickItem>([
    {
      label: "$(circle-slash) No summary",
      description: "Default",
      detail: "Switch without carrying a summary of the path being left.",
      mode: "none",
    },
    {
      label: "$(list-unordered) Summarize branch",
      detail: "Use Pi's default branch-summary instructions.",
      mode: "default",
    },
    {
      label: "$(edit) Summarize with focus",
      detail: "Add focus instructions for Pi's branch summary.",
      mode: "custom",
    },
  ], {
    title: "Leave current branch",
    placeHolder: "Choose how to preserve context from the current path",
    ignoreFocusOut: true,
  });
  if (!selected) return undefined;
  if (selected.mode === "none") return { summarize: false };
  if (selected.mode === "default") return { summarize: true };

  const customInstructions = await host.window.showInputBox({
    title: "Branch summary focus",
    prompt: "What should Pi emphasize in the branch summary?",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const normalized = value.trim();
      if (!normalized) return "Enter summary focus instructions.";
      return normalized.length > 8_192 ? "Summary focus instructions must be 8,192 characters or fewer." : undefined;
    },
  });
  if (customInstructions === undefined) return undefined;
  return { summarize: true, customInstructions: customInstructions.trim() };
}

export async function confirmDraftReplacement(host: ClientHost): Promise<boolean> {
  const choice = await host.window.showWarningDialog(
    "Switching to this user prompt will replace the current Composer draft.",
    ["Replace draft"],
  );
  return choice === "Replace draft";
}
