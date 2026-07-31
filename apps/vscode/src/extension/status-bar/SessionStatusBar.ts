import * as vscode from "vscode";

import type { SessionRegistry } from "../sessions/SessionRegistry.js";

export class SessionStatusBar implements vscode.Disposable {
  readonly #item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
  readonly #disposable: vscode.Disposable;

  readonly #registry: SessionRegistry;

  constructor(registry: SessionRegistry) {
    this.#registry = registry;
    this.#item.command = "frostpi.focus";
    this.#item.name = "FrostPi session status";
    this.#disposable = registry.onDidChange(() => this.#render());
    this.#render();
    this.#item.show();
  }

  dispose(): void {
    this.#disposable.dispose();
    this.#item.dispose();
  }

  #render(): void {
    const active = this.#registry.snapshot().activeSession;
    if (!active) {
      this.#item.text = "$(sparkle) FrostPi";
      this.#item.tooltip = "Open FrostPi";
      return;
    }
    const icon = active.status === "running" ? "$(sync~spin)" : active.status === "failed" ? "$(error)" : "$(sparkle)";
    this.#item.text = `${icon} ${active.title}`;
    this.#item.tooltip = [
      `FrostPi: ${active.status}`,
      active.model ? `${active.model.provider}/${active.model.id}` : "No model selected",
      active.isCompacting ? "Compacting context" : "",
    ].filter(Boolean).join("\n");
  }
}
