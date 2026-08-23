import type { SessionSummaryView, SessionViewModel } from "./sessionViewModel.js";

export type WebviewSurface =
  | { kind: "sidebar" }
  | { kind: "panel"; sessionId: string };

export interface WebviewPresentationView {
  surface: WebviewSurface;
  workspaceName: string;
  workspacePath: string;
  sessions: SessionSummaryView[];
  /** The sidebar selection. Panel focus never changes this value. */
  activeSessionId: string | null;
  displayedSession: SessionViewModel | null;
  composerDraftAuthority: "webview" | "host";
  sidebarSessionExternalized: boolean;
  piAvailable: boolean;
  piError?: string;
}
