import type { HostToWebviewMessage } from "@frostime/pi-client/shared/bridge/hostToWebview";
import type { WebviewToHostMessage } from "@frostime/pi-client/shared/bridge/webviewToHost";

export interface DesktopProject {
  id: string;
  name: string;
  cwd: string;
}

export interface DesktopProjectsView {
  projects: DesktopProject[];
  activeProjectId: string | null;
}

export type DesktopDialog =
  | { id: string; kind: "pick"; title: string; placeholder: string; matchOnDescription: boolean; matchOnDetail: boolean; items: Array<{ id: string; label: string; description?: string; detail?: string; alwaysShow?: boolean; separator?: boolean }> }
  | { id: string; kind: "input"; title: string; prompt: string; placeholder: string; value: string; error?: string };

/** The renderer gets this finite bridge, never ipcRenderer or Node access. */
export interface DesktopApi {
  postClientMessage(message: WebviewToHostMessage): void;
  onClientMessage(listener: (message: HostToWebviewMessage) => void): () => void;
  requestProjects(): void;
  addProject(): void;
  selectProject(id: string): void;
  onProjects(listener: (view: DesktopProjectsView) => void): () => void;
  onDialog(listener: (request: DesktopDialog | null) => void): () => void;
  respondDialog(id: string, value: string | null): void;
}

declare global {
  interface Window { frostpiDesktop: DesktopApi }
}
