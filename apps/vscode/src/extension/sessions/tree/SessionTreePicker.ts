import * as vscode from "vscode";

import type { BranchEndChoiceProjection } from "./sessionTreeProjection.js";
import type { SessionTreeSummaryOptions } from "./SessionTreeExtensionBridge.js";

interface BranchQuickPickItem extends vscode.QuickPickItem {
  choice: BranchEndChoiceProjection;
}

type SessionTreeQuickPickItem = BranchQuickPickItem | vscode.QuickPickItem;

export async function pickBranchEnd(
  choices: readonly BranchEndChoiceProjection[],
): Promise<BranchEndChoiceProjection | undefined> {
  const current = choices.filter((choice) => choice.isCurrent);
  const alternatives = choices.filter((choice) => !choice.isCurrent);
  const items: SessionTreeQuickPickItem[] = [
    ...(current.length ? [separator("Current path"), ...current.map(branchItem)] : []),
    ...(alternatives.length ? [separator("Other paths"), ...alternatives.map(branchItem)] : []),
  ];
  const selected = await vscode.window.showQuickPick(items, {
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

function separator(label: string): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
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

export async function pickBranchSummary(): Promise<SessionTreeSummaryOptions | undefined> {
  const selected = await vscode.window.showQuickPick([
    {
      label: "$(circle-slash) No summary",
      description: "Default",
      detail: "Switch without carrying a summary of the path being left.",
      mode: "none" as const,
    },
    {
      label: "$(list-unordered) Summarize branch",
      detail: "Use Pi's default branch-summary instructions.",
      mode: "default" as const,
    },
    {
      label: "$(edit) Summarize with focus",
      detail: "Add focus instructions for Pi's branch summary.",
      mode: "custom" as const,
    },
  ], {
    title: "Leave current branch",
    placeHolder: "Choose how to preserve context from the current path",
    ignoreFocusOut: true,
  });
  if (!selected) return undefined;
  if (selected.mode === "none") return { summarize: false };
  if (selected.mode === "default") return { summarize: true };

  const customInstructions = await vscode.window.showInputBox({
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

export async function confirmDraftReplacement(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    "Switching to this user prompt will replace the current Composer draft.",
    { modal: true },
    "Replace draft",
  );
  return choice === "Replace draft";
}
