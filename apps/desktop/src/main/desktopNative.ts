import type { HostOpenFileDialogOptions } from "@frostime/pi-client/host";
import type { DesktopUpdateAction, DesktopUpdateNativeView } from "../shared/desktopUpdates.js";

/** Desktop-native operations are requested by the trusted Node host, never by raw renderer IPC. */
export interface DesktopNative {
  focused(): boolean;
  message(level: "info" | "warning" | "error", message: string): Promise<void>;
  confirm(level: "info" | "warning", message: string, actions: readonly string[]): Promise<string | undefined>;
  openFiles(options: HostOpenFileDialogOptions): Promise<string[] | undefined>;
  chooseDirectory(): Promise<string | undefined>;
  writeClipboard(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  /** Starts a program outside the process Job; only registered Project actions supply the command. */
  launch(executable: string, args: readonly string[]): Promise<void>;
  /** The native update owner keeps packages, signatures and the installer; no path is supplied here. */
  updates(action: DesktopUpdateAction): Promise<DesktopUpdateNativeView>;
  appearance(theme: "dark" | "light", background: string, zoom: number): void;
}

export interface DesktopTransport {
  /** False means the message was not accepted for delivery. */
  publish(channel: string, value: unknown): boolean;
  listen(channel: string, action: (...values: unknown[]) => void | Promise<void>): () => void;
  handle(channel: string, action: (value: unknown) => Promise<unknown>): () => void;
  visible(): boolean;
  onVisibility(listener: (visible: boolean) => void): () => void;
}
