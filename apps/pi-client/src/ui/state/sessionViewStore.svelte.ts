import { writable } from "svelte/store";

import type { WebviewPresentationView } from "$shared/model/webviewPresentationModel";

export const EMPTY_PRESENTATION: WebviewPresentationView = {
  surface: { kind: "sidebar" },
  workspaceName: "",
  workspacePath: "",
  sessions: [],
  activeSessionId: null,
  displayedSession: null,
  composerDraftAuthority: "webview",
  sidebarSessionExternalized: false,
  piAvailable: true,
};

export const presentationStore = writable<WebviewPresentationView>(EMPTY_PRESENTATION);
export const composerFocusTick = writable(0);

export interface ToastItem {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
}

export const toastStore = writable<ToastItem[]>([]);
let toastId = 0;

export function showToast(level: ToastItem["level"], message: string): void {
  const id = ++toastId;
  toastStore.update((items) => [...items, { id, level, message }].slice(-4));
  window.setTimeout(() => toastStore.update((items) => items.filter((item) => item.id !== id)), 5_000);
}
