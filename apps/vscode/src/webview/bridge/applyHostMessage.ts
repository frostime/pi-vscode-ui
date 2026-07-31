import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { CollectionDelta, HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { ChatTypographyView } from "$shared/model/chatTypography";
import type { SessionViewModel } from "$shared/model/sessionViewModel";

import { insertDraftText, setDraftText } from "../features/composer/composerDraftStore.svelte";
import { composerFocusTick, showToast, workspaceStore } from "../state/sessionViewStore.svelte";
import { promptSubmissionResult } from "../features/composer/promptSubmissionStore.svelte";
import { deliverWorkspaceFileSuggestions } from "../features/composer/fileSuggestionClient";
import { applyComposerSeed } from "../features/composer/composerSeedClient";
import { resolveForkResult } from "../features/conversation/forkMessageClient";

export function applyHostMessage(message: HostToWebviewMessage): void {
  if (message.bridgeVersion !== BRIDGE_VERSION) {
    showToast("error", "FrostPi UI and extension host are incompatible. Reload the window.");
    return;
  }
  switch (message.type) {
    case "setChatTypography":
      applyChatTypography(message.typography);
      break;
    case "snapshot":
      workspaceStore.set(message.workspace);
      applyComposerSeed(message.workspace.activeSession);
      break;
    case "workspaceDelta": {
      let activeSession: SessionViewModel | null = null;
      workspaceStore.update((current) => {
        const incoming = message.workspace.activeSession;
        const existing = current.activeSession?.id === incoming?.base.id ? current.activeSession : null;
        activeSession = incoming ? {
          ...incoming.base,
          conversationItems: mergeCollection(
            existing?.conversationItems ?? [],
            incoming.conversationItems,
          ),
        } : null;
        return {
          workspaceName: message.workspace.workspaceName,
          workspacePath: message.workspace.workspacePath,
          sessions: message.workspace.sessions,
          activeSessionId: message.workspace.activeSessionId,
          piAvailable: message.workspace.piAvailable,
          ...(message.workspace.piError ? { piError: message.workspace.piError } : {}),
          activeSession,
        };
      });
      applyComposerSeed(activeSession);
      break;
    }
    case "insertPromptText": {
      let activeId: string | null = null;
      workspaceStore.update((workspace) => {
        activeId = workspace.activeSessionId;
        return workspace;
      });
      if (activeId) insertDraftText(activeId, message.text);
      composerFocusTick.update((value) => value + 1);
      break;
    }
    case "setComposerText": {
      setDraftText(message.sessionId, message.text);
      let activeId: string | null = null;
      workspaceStore.update((workspace) => {
        activeId = workspace.activeSessionId;
        return workspace;
      });
      if (activeId === message.sessionId) composerFocusTick.update((value) => value + 1);
      break;
    }
    case "focusComposer":
      composerFocusTick.update((value) => value + 1);
      break;
    case "promptResult":
      promptSubmissionResult.set(message);
      if (!message.ok && message.error) showToast("error", message.error);
      break;
    case "forkResult":
      resolveForkResult(message);
      break;
    case "workspaceFileSuggestions":
      deliverWorkspaceFileSuggestions(message.requestId, message.items, message.error, message.specials);
      break;
    case "toast":
      showToast(message.level, message.message);
      break;
  }
}

function applyChatTypography(typography: ChatTypographyView): void {
  const style = document.documentElement.style;
  setOptionalCssProperty(style, "--frostpi-chat-message-font-family", typography.message.fontFamily);
  style.setProperty("--frostpi-chat-message-font-size", `${typography.message.fontSize}px`);
  setOptionalCssProperty(style, "--frostpi-chat-composer-font-family", typography.composer.fontFamily);
  style.setProperty("--frostpi-chat-composer-font-size", `${typography.composer.fontSize}px`);
}

function setOptionalCssProperty(style: CSSStyleDeclaration, name: string, value: string | undefined): void {
  if (value) style.setProperty(name, value);
  else style.removeProperty(name);
}

export function mergeCollection<T extends { id: string }>(current: readonly T[], delta: CollectionDelta<T>): T[] {
  if (delta.mode === "replace") return [...delta.items];
  if (delta.items.length === 0) return [...current];
  const updates = new Map(delta.items.map((item) => [item.id, item]));
  const merged = current.map((item) => updates.get(item.id) ?? item);
  const known = new Set(current.map((item) => item.id));
  for (const item of delta.items) if (!known.has(item.id)) merged.push(item);
  return merged;
}
