import * as vscode from "vscode";

import { BRIDGE_VERSION } from "../../shared/bridge/bridgeVersion.js";
import type { HostToWebviewPayload, PresentationDeltaView } from "../../shared/bridge/hostToWebview.js";
import { webviewToHostSchema } from "../../shared/bridge/webviewToHost.js";
import type { ConversationItemView } from "../../shared/model/conversationModel.js";
import type { SessionViewModel } from "../../shared/model/sessionViewModel.js";
import type { WebviewPresentationView } from "../../shared/model/webviewPresentationModel.js";
import { WorkspaceFileSearch } from "../composer/mentions/WorkspaceFileSearch.js";
import { readChatTypography } from "../configuration/readChatTypography.js";
import type { DiagnosticLogger } from "../diagnostics/DiagnosticLogger.js";
import type { SessionRegistry } from "../sessions/SessionRegistry.js";
import { collectionDelta } from "./collectionDelta.js";
import type { ComposerDraftCache } from "./ComposerDraftCache.js";
import type { DispatchConnection, WebviewActionDispatcher } from "./WebviewActionDispatcher.js";
import type { WebviewEndpoint } from "./webviewTypes.js";

interface Identified {
  id: string;
}

export class WebviewConnection implements vscode.Disposable {
  readonly #registry: SessionRegistry;
  readonly #endpoint: WebviewEndpoint;
  readonly #dispatcher: WebviewActionDispatcher;
  readonly #drafts: ComposerDraftCache;
  readonly #logger: DiagnosticLogger;
  readonly #isExternalized: (sessionId: string) => boolean;
  readonly #disposables: vscode.Disposable[] = [];
  readonly fileSearch: WorkspaceFileSearch;

  #ready = false;
  #dirty = true;
  #disposed = false;
  #cachedSessionId: string | null = null;
  #conversationItemOrder: string[] = [];
  #conversationItemRefs = new Map<string, ConversationItemView>();
  #outbound: Promise<void> = Promise.resolve();

  constructor(
    registry: SessionRegistry,
    endpoint: WebviewEndpoint,
    dispatcher: WebviewActionDispatcher,
    drafts: ComposerDraftCache,
    logger: DiagnosticLogger,
    isExternalized: (sessionId: string) => boolean,
  ) {
    this.#registry = registry;
    this.#endpoint = endpoint;
    this.#dispatcher = dispatcher;
    this.#drafts = drafts;
    this.#logger = logger;
    this.#isExternalized = isExternalized;
    this.fileSearch = new WorkspaceFileSearch({
      onLegacyFd: (fd) => {
        void vscode.window.showWarningMessage(
          `FrostPi found fd ${fd.version}. File completion remains available, but directory suggestions require fd 10.0.0 or newer.`,
        );
      },
    });
    this.#disposables.push(
      endpoint.webview.onDidReceiveMessage((raw: unknown) => void this.#receive(raw)),
      endpoint.onDidBecomeVisible(() => {
        this.#dirty = true;
        this.refresh();
      }),
    );
  }

  get surface() {
    return this.#endpoint.surface;
  }

  get sessionId(): string | null {
    return this.surface.kind === "panel" ? this.surface.sessionId : this.#registry.activeSessionId;
  }

  refresh(): void {
    if (!this.#ready || this.#disposed) return;
    if (!this.#endpoint.isVisible()) {
      this.#dirty = true;
      return;
    }
    this.#enqueue(async () => {
      if (this.#dirty || this.sessionId !== this.#cachedSessionId) await this.#sendSnapshot();
      else await this.#sendDelta();
    });
  }

  draftChanged(sessionId: string): void {
    if (!this.#ready || sessionId !== this.sessionId) return;
    if (!this.#endpoint.isVisible()) {
      this.#dirty = true;
      return;
    }
    this.post({ type: "draftReplacement", sessionId, draft: this.#drafts.get(sessionId) });
  }

  insertPromptText(text: string): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.#drafts.insertText(sessionId, text);
    this.post({ type: "insertPromptText", text });
    this.focusComposer();
  }

  focusComposer(): void {
    this.post({ type: "focusComposer" });
  }

  post(message: HostToWebviewPayload): void {
    this.#enqueue(async () => {
      if (!await this.#post(message)) this.#dirty = true;
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const disposable of this.#disposables) disposable.dispose();
    this.fileSearch.dispose();
  }

  async #receive(raw: unknown): Promise<void> {
    const parsed = webviewToHostSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.error("Rejected invalid Webview message", parsed.error);
      return;
    }
    if (parsed.data.type === "ready") {
      this.#ready = true;
      this.#dirty = true;
      this.#enqueue(async () => {
        await this.#sendSnapshot();
        await this.#post({
          type: "setChatTypography",
          typography: readChatTypography(vscode.workspace.getConfiguration("chat")),
        });
      });
      return;
    }

    try {
      const context: DispatchConnection = {
        surface: this.surface,
        sessionId: this.sessionId,
        fileSearch: this.fileSearch,
        post: (message) => this.post(message),
        insertPromptText: (text) => this.insertPromptText(text),
      };
      await this.#dispatcher.dispatch(parsed.data, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error(`Webview action ${parsed.data.type} failed`, error);
      this.post({ type: "toast", level: "error", message });
    }
  }

  async #sendSnapshot(): Promise<void> {
    const presentation = this.#presentation();
    const delivered = await this.#post({
      type: "snapshot",
      presentation,
      draft: presentation.displayedSession
        ? this.#drafts.get(presentation.displayedSession.id)
        : { revision: 0, text: "", images: [] },
    });
    if (!delivered) {
      this.#dirty = true;
      return;
    }
    this.#dirty = false;
    this.#resetCache(presentation.displayedSession);
  }

  async #sendDelta(): Promise<void> {
    const presentation = this.#presentation();
    const displayed = presentation.displayedSession;
    if (displayed?.id !== this.#cachedSessionId) {
      await this.#sendSnapshot();
      return;
    }
    const sessionDelta = displayed ? this.#sessionDelta(displayed) : null;
    const delta: PresentationDeltaView = {
      ...presentation,
      displayedSession: sessionDelta?.view ?? null,
    };
    const delivered = await this.#post({ type: "presentationDelta", presentation: delta });
    if (!delivered) {
      this.#dirty = true;
      return;
    }
    if (sessionDelta) {
      this.#conversationItemOrder = sessionDelta.order;
      this.#conversationItemRefs = sessionDelta.refs;
    }
  }

  #presentation(): WebviewPresentationView {
    const workspace = this.#registry.snapshot();
    const displayedSession = this.sessionId ? this.#registry.sessionView(this.sessionId) : null;
    const piError = displayedSession?.status === "failed" ? displayedSession.error : undefined;
    return {
      surface: this.surface,
      workspaceName: workspace.workspaceName,
      workspacePath: workspace.workspacePath,
      sessions: workspace.sessions,
      activeSessionId: workspace.activeSessionId,
      displayedSession,
      sidebarSessionExternalized: this.surface.kind === "sidebar"
        && Boolean(displayedSession && this.#isExternalized(displayedSession.id)),
      piAvailable: !piError,
      ...(piError ? { piError } : {}),
    };
  }

  #sessionDelta(session: SessionViewModel): {
    view: NonNullable<PresentationDeltaView["displayedSession"]>;
    order: string[];
    refs: Map<string, ConversationItemView>;
  } {
    const { conversationItems, ...base } = session;
    return {
      view: {
        base,
        conversationItems: collectionDelta(this.#conversationItemOrder, this.#conversationItemRefs, conversationItems),
      },
      order: conversationItems.map((item) => item.id),
      refs: referenceMap(conversationItems),
    };
  }

  #resetCache(session: SessionViewModel | null): void {
    this.#cachedSessionId = session?.id ?? null;
    this.#conversationItemOrder = session?.conversationItems.map((item) => item.id) ?? [];
    this.#conversationItemRefs = referenceMap(session?.conversationItems ?? []);
  }

  #enqueue(work: () => Promise<void>): void {
    this.#outbound = this.#outbound.then(work, work).catch((error) => {
      this.#dirty = true;
      this.#logger.error("Failed to synchronize FrostPi Webview", error);
    });
  }

  async #post(message: HostToWebviewPayload): Promise<boolean> {
    if (this.#disposed) return false;
    return this.#endpoint.webview.postMessage({ ...message, bridgeVersion: BRIDGE_VERSION });
  }
}

function referenceMap<T extends Identified>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}
