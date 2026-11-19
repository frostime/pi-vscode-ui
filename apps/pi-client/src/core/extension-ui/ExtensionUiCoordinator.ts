import type { PiRpcApi, RpcExtensionUiRequest, RpcExtensionUiResponse } from "@frostime/pi-rpc";

import type { ExtensionStatusView, ExtensionWidgetView, PendingExtensionUiView, QuestionSelectView } from "../../shared/model/extensionUiModel.js";
import { projectDeferredQuestionSelect } from "./matchQuestionSelect.js";
import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const deferredQuestionHeading = /^Answer when ready \[([0-9a-f-]{36})\]\n/;
const deferredQuestionStatus = "rpiv-deferred-question-dialog";

export interface ExtensionUiEffects {
  onChange(): void;
  onNotify(level: "info" | "warning" | "error", message: string): void;
  onTitle(title: string): void;
  onEditorText(text: string): void;
}

export class ExtensionUiCoordinator {
  readonly #pending = new Map<string, PendingExtensionUiView>();
  readonly #statuses = new Map<string, ExtensionStatusView>();
  readonly #widgets = new Map<string, ExtensionWidgetView>();
  readonly #timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  #deferredQuestionTicket: string | undefined;

  readonly #api: PiRpcApi;
  readonly #effects: ExtensionUiEffects;

  constructor(api: PiRpcApi, effects: ExtensionUiEffects) {
    this.#api = api;
    this.#effects = effects;
  }

  snapshot(): {
    pending: PendingExtensionUiView[];
    statuses: ExtensionStatusView[];
    widgets: ExtensionWidgetView[];
  } {
    return {
      pending: [...this.#pending.values()],
      statuses: [...this.#statuses.values()],
      widgets: [...this.#widgets.values()],
    };
  }

  handle(request: RpcExtensionUiRequest, questionSelect?: QuestionSelectView): void {
    if (DIALOG_METHODS.has(request.method)) {
      const method = request.method as "select" | "confirm" | "input" | "editor";
      const heading = method === "select" || method === "input" ? deferredQuestionHeading.exec(request.title ?? "") : null;
      const deferred = heading?.[1] === this.#deferredQuestionTicket ? heading : null;
      this.#deferredQuestionTicket = undefined;
      const deferredQuestionId = deferred?.[1];
      const title = deferred ? request.title?.slice(deferred[0].length) : request.title;
      const question = deferred && method === "select" ? projectDeferredQuestionSelect(title, request.options) : questionSelect;
      for (const [id, pending] of this.#pending) {
        if (deferredQuestionId && pending.method !== "question" && pending.deferredQuestionId === deferredQuestionId) {
          this.#pending.delete(id);
          this.#clearTimeout(id);
        }
      }
      this.addPending({
        id: request.id,
        method,
        title: title ? sanitizeExtensionUiText(title) : defaultTitle(method),
        ...(request.message ? { message: sanitizeExtensionUiText(request.message) } : {}),
        ...(request.options ? { options: request.options } : {}),
        ...(question ? { questionSelect: question } : {}),
        ...(deferredQuestionId ? { deferredQuestionId } : {}),
        ...(request.placeholder ? { placeholder: request.placeholder } : {}),
        ...(request.prefill ? { prefill: request.prefill } : {}),
        receivedAt: Date.now(),
      }, request.timeout);
      return;
    }

    switch (request.method) {
      case "notify":
        this.#effects.onNotify(request.notifyType ?? "info", sanitizeExtensionUiText(request.message ?? "Pi extension notification"));
        break;
      case "setStatus":
        if (!request.statusKey) break;
        if (request.statusKey === deferredQuestionStatus) {
          this.#deferredQuestionTicket = request.statusText;
          return;
        }
        if (request.statusText) this.#statuses.set(request.statusKey, { key: request.statusKey, text: sanitizeExtensionUiText(request.statusText) });
        else this.#statuses.delete(request.statusKey);
        this.#effects.onChange();
        break;
      case "setWidget": {
        if (!request.widgetKey) break;
        if (request.widgetLines) {
          this.#widgets.set(request.widgetKey, {
            key: request.widgetKey,
            lines: request.widgetLines.map(sanitizeExtensionUiText),
            placement: request.widgetPlacement === "belowEditor" ? "below" : "above",
          });
        } else this.#widgets.delete(request.widgetKey);
        this.#effects.onChange();
        break;
      }
      case "setTitle":
        if (request.title) this.#effects.onTitle(sanitizeExtensionUiText(request.title));
        break;
      case "set_editor_text":
        this.#effects.onEditorText(request.text ?? "");
        break;
      default:
        break;
    }
  }

  addPending(request: PendingExtensionUiView, timeout?: number): void {
    this.#clearTimeout(request.id);
    this.#pending.set(request.id, request);
    if (typeof timeout === "number" && timeout > 0) {
      const timer = setTimeout(() => {
        this.#timeouts.delete(request.id);
        if (this.#pending.delete(request.id)) this.#effects.onChange();
      }, timeout);
      this.#timeouts.set(request.id, timer);
    }
    this.#effects.onChange();
  }

  pending(requestId: string): PendingExtensionUiView | undefined {
    return this.#pending.get(requestId);
  }

  clearSessionDecorations(): void {
    this.#deferredQuestionTicket = undefined;
    this.#statuses.clear();
    this.#widgets.clear();
    this.#effects.onChange();
  }

  restoreSessionDecorations(
    statuses: readonly ExtensionStatusView[],
    widgets: readonly ExtensionWidgetView[],
  ): void {
    this.#statuses.clear();
    this.#widgets.clear();
    for (const status of statuses) this.#statuses.set(status.key, status);
    for (const widget of widgets) this.#widgets.set(widget.key, widget);
    this.#effects.onChange();
  }

  async respond(requestId: string, response: RpcExtensionUiResponse): Promise<void> {
    if (!this.#pending.has(requestId)) throw new Error("The extension UI request is no longer pending.");
    this.#pending.delete(requestId);
    this.#clearTimeout(requestId);
    this.#effects.onChange();
    await this.#api.sendExtensionUiResponse(requestId, response);
  }

  async cancelAll(preserveDeferred = false): Promise<void> {
    const cancelled: string[] = [];
    for (const [id, request] of this.#pending) {
      const deferred = request.method !== "question" && request.deferredQuestionId;
      if (deferred && preserveDeferred) continue;
      this.#pending.delete(id);
      this.#clearTimeout(id);
      if (!deferred) cancelled.push(id);
    }
    this.#effects.onChange();
    await Promise.allSettled(cancelled.map((id) => this.#api.sendExtensionUiResponse(id, { cancelled: true })));
  }

  #clearTimeout(requestId: string): void {
    const timer = this.#timeouts.get(requestId);
    if (!timer) return;
    clearTimeout(timer);
    this.#timeouts.delete(requestId);
  }
}

function defaultTitle(method: string): string {
  if (method === "confirm") return "Confirmation required";
  if (method === "select") return "Choose an option";
  if (method === "editor") return "Edit text";
  return "Input required";
}
