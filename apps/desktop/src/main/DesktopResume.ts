import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { SessionViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import type { DesktopDialog, DesktopProject, DesktopResumeView } from "../shared/desktopBridge.js";

interface DesktopResumeInputs {
  project(): DesktopProject | null | undefined;
  session(id: string): SessionViewModel | null | undefined;
  publish(view: DesktopResumeView | null): void;
}

/** Presentation for one Desktop Resume flow, not a task/progress service. */
export class DesktopResume {
  readonly #inputs: DesktopResumeInputs;
  // Other concurrent Host selections must not become this Resume's picker.
  readonly #scope = new AsyncLocalStorage<string>();
  #view: DesktopResumeView | null = null;
  #pending: Promise<string | undefined> | undefined;
  #disposed = false;

  constructor(inputs: DesktopResumeInputs) {
    this.#inputs = inputs;
  }

  get view(): DesktopResumeView | null { return this.#view; }

  run(work: () => Promise<string | undefined>): Promise<string | undefined> {
    if (this.#disposed) return Promise.reject(new Error("The Desktop window is closed."));
    if (this.#view && this.#view.phase !== "failed") {
      this.show(this.#view.id);
      return this.#pending ?? Promise.resolve(this.#view.sessionId);
    }
    const project = this.#inputs.project();
    const id = randomUUID();
    this.#set({
      id, phase: "finding", visible: true, project: project?.name ?? "Workspace", cwd: project?.cwd ?? "",
      ...(project ? { projectId: project.id } : {}),
    });
    const pending = this.#scope.run(id, async () => {
      // Publish before discovery begins, including when no Runtime exists yet.
      await Promise.resolve();
      try {
        const sessionId = await work();
        if (this.#view?.id === id) {
          if (sessionId) {
            this.#set({ ...this.#view, phase: "opening", sessionId });
            this.refresh();
          } else this.#set(null);
        }
        return sessionId;
      } catch (error) {
        if (this.#view?.id === id) this.#set({
          ...this.#view, phase: "failed",
          error: error instanceof Error ? error.message : "The saved session could not be opened.",
        });
        throw error;
      } finally {
        if (this.#pending === pending) this.#pending = undefined;
      }
    });
    this.#pending = pending;
    return pending;
  }

  async choose<T>(selection: NonNullable<DesktopResumeView["selection"]>, work: () => Promise<T>): Promise<T> {
    const id = this.#scope.getStore();
    if (!id || this.#view?.id !== id) return work();
    const choosing: DesktopResumeView = { ...this.#view, phase: "choosing", selection };
    delete choosing.pickerId;
    this.#set(choosing);
    const result = await work();
    if (this.#view?.id === id && result !== undefined && result !== null) {
      const opening: DesktopResumeView = { ...this.#view, phase: "opening" };
      delete opening.selection;
      delete opening.pickerId;
      this.#set(opening);
    }
    return result;
  }

  dialogShown(request: DesktopDialog | null): void {
    if (request?.kind !== "pick" || this.#scope.getStore() !== this.#view?.id) return;
    if (this.#view?.phase === "choosing" && this.#view.selection === "session") {
      this.#set({ ...this.#view, pickerId: request.id });
    }
  }

  /** Registry projection is the history authority; readiness alone is not completion. */
  refresh(): void {
    const view = this.#view;
    if (!view?.sessionId || view.phase === "failed") return;
    const session = this.#inputs.session(view.sessionId);
    if (!session || session.status === "failed" || session.status === "stopped" || session.historyStatus === "failed") {
      this.#set({ ...view, phase: "failed", error: session?.error ?? "The session stopped or its conversation history could not be loaded." });
    } else if (session.status === "queued" || session.status === "starting") {
      this.#set({ ...view, phase: "opening", sessionTitle: session.title });
    } else if (session.historyStatus === "loaded" || session.historyStatus === "deferred") {
      // Deferred history stays in the shared client's existing busy/history UI.
      this.#set(null);
    } else this.#set({ ...view, phase: "loading", sessionTitle: session.title });
  }

  show(id: unknown): void {
    if (typeof id === "string" && this.#view?.id === id) this.#set({ ...this.#view, visible: true });
  }

  hide(): void {
    if (this.#view?.visible) this.#set({ ...this.#view, visible: false });
  }

  dismiss(id: unknown): void {
    if (typeof id === "string" && this.#view?.id === id && this.#view.phase === "failed") this.#set(null);
  }

  publish(): void { this.#inputs.publish(this.#view); }

  dispose(): void {
    this.#set(null);
    this.#disposed = true;
  }

  #set(view: DesktopResumeView | null): void {
    if (this.#disposed) return;
    this.#view = view;
    this.#inputs.publish(view);
  }
}
