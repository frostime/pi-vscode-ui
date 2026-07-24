import type { PiRpcApi, RpcExtensionUiRequest, RpcExtensionUiResponse } from "@frostime/pi-rpc";

import type { ExtensionStatusView, ExtensionWidgetView, PendingExtensionUiView } from "../../shared/model/extensionUiModel.js";
import { sanitizeExtensionUiText } from "./sanitizeExtensionUiText.js";

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

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

  handle(request: RpcExtensionUiRequest): void {
    if (DIALOG_METHODS.has(request.method)) {
      const method = request.method as "select" | "confirm" | "input" | "editor";
      this.addPending({
        id: request.id,
        method,
        title: request.title ? sanitizeExtensionUiText(request.title) : defaultTitle(method),
        ...(request.message ? { message: sanitizeExtensionUiText(request.message) } : {}),
        ...(request.options ? { options: request.options } : {}),
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

  async cancelAll(): Promise<void> {
    const ids = [...this.#pending.keys()];
    this.#pending.clear();
    for (const id of ids) this.#clearTimeout(id);
    this.#effects.onChange();
    await Promise.allSettled(ids.map((id) => this.#api.sendExtensionUiResponse(id, { cancelled: true })));
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
