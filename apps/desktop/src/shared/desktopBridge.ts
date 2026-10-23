import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import type { WebviewToHostMessage } from "@frostime/pi-client/shared/bridge/webviewToHost";
import type { DesktopSettingsAction, DesktopSettingsTarget, DesktopSettingsView } from "./desktopSettings.js";

export interface DesktopProject {
  id: string;
  name: string;
  cwd: string;
}

export const DESKTOP_SIDEBAR_WIDTH = { default: 252, min: 180, max: 340 } as const;

export interface DesktopSidebarLayout {
  hidden: boolean;
  width: number;
}

export interface DesktopProjectActivity {
  total: number;
  running: number;
  waitingSessionIds: string[];
}

export interface DesktopProjectNavigationView {
  sidebar: DesktopSidebarLayout;
  sessionProjects: Record<string, string>;
  activity: Record<string, DesktopProjectActivity>;
}

export interface DesktopProjectsView {
  projects: DesktopProject[];
  activeProjectId: string | null;
  /** Desktop-only navigation metadata; never copied into the shared Session model. */
  navigation?: DesktopProjectNavigationView;
  /** Transient persistence status, never part of the saved Project data. */
  stateError?: string;
}

export type DesktopDialog =
  | { id: string; kind: "pick"; title: string; placeholder: string; matchOnDescription: boolean; matchOnDetail: boolean; items: Array<{ id: string; label: string; description?: string; detail?: string; alwaysShow?: boolean; separator?: boolean }> }
  | { id: string; kind: "input"; title: string; prompt: string; placeholder: string; value: string; error?: string };

export interface DesktopResumeView {
  id: string;
  phase: "finding" | "choosing" | "opening" | "loading" | "failed";
  visible: boolean;
  project: string;
  projectId?: string;
  cwd: string;
  selection?: "session" | "file" | "confirmation";
  pickerId?: string;
  sessionId?: string;
  sessionTitle?: string;
  error?: string;
}

/** The renderer gets this finite bridge, never ipcRenderer or Node access. */
export interface DesktopApi {
  postClientMessage(message: WebviewToHostMessage): void;
  onClientMessage(listener: (message: HostToWebviewMessage) => void): () => void;
  requestProjects(): void;
  addProject(): void;
  selectProject(id: string): void;
  setSidebar(layout: DesktopSidebarLayout): void;
  onProjects(listener: (view: DesktopProjectsView) => void): () => void;
  onDialog(listener: (request: DesktopDialog | null) => void): () => void;
  respondDialog(id: string, value: string | null): void;
  onResume(listener: (view: DesktopResumeView | null) => void): () => void;
  requestResume(): void;
  showResume(id: string): void;
  dismissResume(id: string): void;
  settings(action: DesktopSettingsAction): Promise<DesktopSettingsView>;
  onSettings(listener: (view: DesktopSettingsView) => void): () => void;
  onOpenSettings(listener: (target: DesktopSettingsTarget) => void): () => void;
}

declare global {
  interface Window { frostpiDesktop: DesktopApi }
}
