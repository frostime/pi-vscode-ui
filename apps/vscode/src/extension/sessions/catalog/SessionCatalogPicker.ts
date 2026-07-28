import * as vscode from "vscode";

import { workspaceUriForPath } from "../../configuration/workspaceScope.js";
import {
  findSessionWorkingDirectory,
  type SessionWorkingDirectory,
} from "../SessionWorkingDirectories.js";
import {
  discoverPiSessions,
  readPiSessionMetadata,
  samePath,
  type PiSessionCatalogEntry,
} from "./SessionCatalog.js";

type PiSessionQuickPickItem = vscode.QuickPickItem & { entry?: PiSessionCatalogEntry; browse?: true };

export async function pickPiSession(
  directories: readonly SessionWorkingDirectory[],
  piArguments: string[],
): Promise<PiSessionCatalogEntry | undefined> {
  const current = directories[0];
  if (!current) return undefined;
  const sessions = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: "Finding Pi sessions…" },
    () => discoverPiSessions(directories, piArguments),
  );

  const browse: PiSessionQuickPickItem = {
    label: "$(folder-opened) Browse for a session file…",
    description: "Open a Pi JSONL session directly",
    alwaysShow: true,
    browse: true,
  };
  const items = buildSessionQuickPickItems(sessions, directories);
  if (sessions.length) items.push({ label: "Other", kind: vscode.QuickPickItemKind.Separator });
  items.push(browse);

  const selected = await selectSessionQuickPickItem(items, {
    title: "Resume Pi session",
    placeHolder: sessions.length ? "Search sessions across this repository's worktrees" : "No sessions were discovered; browse for a JSONL file",
  });
  if (!selected) return undefined;
  if (selected.entry) return selected.entry;

  const files = await vscode.window.showOpenDialog({
    title: "Open Pi session",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "Pi session": ["jsonl"] },
    defaultUri: workspaceUriForPath(current.cwd),
  });
  if (!files?.[0]) return undefined;
  const entry = await readPiSessionMetadata(files[0].fsPath);
  if (!entry) throw new Error("The selected file is not a readable Pi session.");
  if (!findSessionWorkingDirectory(directories, entry.cwd)) {
    const choice = await vscode.window.showWarningMessage(
      `This session belongs to ${entry.cwd}, which is not an available worktree for this workspace.`,
      "Open folder",
    );
    if (choice === "Open folder") await vscode.commands.executeCommand("vscode.openFolder", workspaceUriForPath(entry.cwd));
    return undefined;
  }
  return entry;
}

export function buildSessionQuickPickItems(
  sessions: readonly PiSessionCatalogEntry[],
  directories: readonly SessionWorkingDirectory[],
): PiSessionQuickPickItem[] {
  const groups = directories
    .map((directory) => {
      const group = sessions
        .filter((entry) => samePath(entry.cwd, directory.cwd))
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { directory, group, latest: group[0]?.updatedAt ?? 0 };
    })
    .filter((entry) => entry.group.length > 0);

  const linked = groups
    .filter((entry) => !entry.directory.isCurrent)
    .sort((a, b) => b.latest - a.latest || a.directory.directoryName.localeCompare(b.directory.directoryName));
  const current = groups.filter((entry) => entry.directory.isCurrent);

  const items: PiSessionQuickPickItem[] = [];
  for (const { directory, group } of [...linked, ...current]) {
    const location = searchableLocation(directory);
    const icon = directory.isCurrent ? "$(comment-discussion)" : "$(git-branch)";
    items.push({ label: separatorLabel(directory), kind: vscode.QuickPickItemKind.Separator });
    for (const entry of group) {
      items.push({
        label: `${icon} ${entry.title}`,
        description: `${location} · ${relativeAge(entry.updatedAt)}`,
        detail: entry.preview ? `${entry.preview}  ·  ${entry.path}` : entry.path,
        entry,
      });
    }
  }
  return items;
}

async function selectSessionQuickPickItem(
  items: readonly PiSessionQuickPickItem[],
  options: { title: string; placeHolder: string },
): Promise<PiSessionQuickPickItem | undefined> {
  const quickPick = vscode.window.createQuickPick<PiSessionQuickPickItem>();
  quickPick.title = options.title;
  quickPick.placeholder = options.placeHolder;
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.ignoreFocusOut = true;
  quickPick.items = items;

  const disposables: vscode.Disposable[] = [];
  try {
    return await new Promise<PiSessionQuickPickItem | undefined>((resolve) => {
      let settled = false;
      const finish = (value: PiSessionQuickPickItem | undefined) => {
        if (settled) return;
        settled = true;
        resolve(value);
        quickPick.hide();
      };
      disposables.push(
        quickPick.onDidAccept(() => finish(quickPick.activeItems[0] ?? quickPick.selectedItems[0])),
        quickPick.onDidHide(() => finish(undefined)),
      );
      quickPick.show();
    });
  } finally {
    for (const disposable of disposables) disposable.dispose();
    quickPick.dispose();
  }
}

function separatorLabel(directory: SessionWorkingDirectory): string {
  // Separator labels are plain text — QuickPick does not render $(codicon) there.
  if (directory.isCurrent) {
    const branch = directory.branch ?? (directory.detached ? "Detached HEAD" : undefined);
    return branch
      ? `Current workspace · ${branch}`
      : `Current workspace · ${directory.directoryName}`;
  }
  const branch = directory.branch ?? (directory.detached ? "Detached HEAD" : undefined);
  return branch ? `Worktree · ${branch} · ${directory.directoryName}` : `Worktree · ${directory.directoryName}`;
}

function searchableLocation(directory: SessionWorkingDirectory): string {
  const source = directory.branch ?? (directory.detached ? "Detached HEAD" : undefined);
  return source ? `${source} · ${directory.directoryName}` : directory.directoryName;
}

function relativeAge(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
