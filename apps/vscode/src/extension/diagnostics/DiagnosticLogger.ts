import * as vscode from "vscode";

import { redactDiagnosticText, redactError } from "@frostime/pi-client/core/diagnostics/diagnosticRedaction";

export type DiagnosticLevel = "error" | "info" | "debug";

const PRIORITY: Record<DiagnosticLevel, number> = { error: 0, info: 1, debug: 2 };

export class DiagnosticLogger implements vscode.Disposable {
  readonly #channel = vscode.window.createOutputChannel("FrostPi", { log: true });
  #level: DiagnosticLevel;

  constructor(level: DiagnosticLevel) {
    this.#level = level;
  }

  setLevel(level: DiagnosticLevel): void {
    this.#level = level;
  }

  error(message: string, error?: unknown): void {
    this.#write("error", message, error);
  }

  info(message: string): void {
    this.#write("info", message);
  }

  debug(message: string): void {
    this.#write("debug", message);
  }

  show(): void {
    this.#channel.show(true);
  }

  contentsHeader(): string {
    return [
      `FrostPi diagnostics`,
      `VS Code: ${vscode.version}`,
      `Node: ${process.version}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Remote: ${vscode.env.remoteName ?? "local"}`,
      `Workspace trusted: ${vscode.workspace.isTrusted}`,
    ].join("\n");
  }

  dispose(): void {
    this.#channel.dispose();
  }

  #write(level: DiagnosticLevel, message: string, error?: unknown): void {
    if (PRIORITY[level] > PRIORITY[this.#level]) return;
    const suffix = error ? ` — ${redactError(error)}` : "";
    if (level === "error") this.#channel.error(`${message}${suffix}`);
    else if (level === "debug") this.#channel.debug(redactDiagnosticText(message));
    else this.#channel.info(redactDiagnosticText(message));
  }
}
