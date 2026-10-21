import { randomUUID } from "node:crypto";

import type { HostInputBoxOptions, HostQuickPickItem, HostQuickPickOptions, HostQuickPickSeparator } from "@frostime/pi-client/host";
import type { DesktopDialog } from "../shared/desktopBridge.js";

export interface DesktopInteractions {
  showQuickPick<T extends HostQuickPickItem>(items: readonly (T | HostQuickPickSeparator)[], options?: HostQuickPickOptions): Promise<T | undefined>;
  showInputBox(options?: HostInputBoxOptions): Promise<string | undefined>;
}

/** One visible native-host interaction; pending requests are cancelled on window disposal. */
export class DesktopDialogs implements DesktopInteractions {
  readonly #publish: (request: DesktopDialog | null) => void;
  #pending: { id: string; accept(value: string | null): void } | undefined;

  constructor(publish: (request: DesktopDialog | null) => void) {
    this.#publish = publish;
  }

  async showQuickPick<T extends HostQuickPickItem>(items: readonly (T | HostQuickPickSeparator)[], options: HostQuickPickOptions = {}): Promise<T | undefined> {
    const id = randomUUID();
    const request: DesktopDialog = {
      id, kind: "pick", title: options.title ?? "Choose an item", placeholder: options.placeHolder ?? "Search",
      matchOnDescription: options.matchOnDescription ?? false, matchOnDetail: options.matchOnDetail ?? false,
      items: items.map((item, index) => ({
        id: String(index), label: item.label,
        ...("description" in item && item.description ? { description: item.description } : {}),
        ...("detail" in item && item.detail ? { detail: item.detail } : {}),
        ...("alwaysShow" in item && item.alwaysShow ? { alwaysShow: true } : {}),
        ...("kind" in item && item.kind === "separator" ? { separator: true } : {}),
      })),
    };
    const selected = await this.#ask(request);
    if (selected === null || !/^\d+$/.test(selected)) return undefined;
    const item = items[Number(selected)];
    return item && !("kind" in item) ? item : undefined;
  }

  async showInputBox(options: HostInputBoxOptions = {}): Promise<string | undefined> {
    const value = await this.#ask({
      id: randomUUID(), kind: "input", title: options.title ?? "Enter a value", prompt: options.prompt ?? "",
      placeholder: options.placeHolder ?? "", value: options.value ?? "",
    }, options.validateInput);
    return value ?? undefined;
  }

  respond(id: unknown, value: unknown): void {
    if (typeof id !== "string" || (value !== null && typeof value !== "string")) return;
    if (this.#pending?.id !== id) return;
    this.#pending.accept(value);
  }

  dispose(): void {
    this.#pending?.accept(null);
  }

  #ask(request: DesktopDialog, validateInput?: (value: string) => string | undefined): Promise<string | null> {
    if (this.#pending) return Promise.reject(new Error("Finish the current desktop selection first."));
    return new Promise((resolve) => {
      this.#pending = {
        id: request.id,
        accept: (value) => {
          if (value !== null && request.kind === "input") {
            const error = value.length > 65_536 ? "Enter 65,536 characters or fewer." : validateInput?.(value);
            if (error) { this.#publish({ ...request, error }); return; }
          }
          this.#pending = undefined;
          this.#publish(null);
          resolve(value);
        },
      };
      this.#publish(request);
    });
  }
}
