import type { HostOpenFileDialogOptions } from "@frostime/pi-client/host";

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
  appearance(theme: "dark" | "light", background: string, zoom: number): void;
}

export interface DesktopTransport {
  publish(channel: string, value: unknown): void;
  listen(channel: string, action: (...values: unknown[]) => void | Promise<void>): () => void;
  handle(channel: string, action: (value: unknown) => Promise<unknown>): () => void;
  visible(): boolean;
  onVisibility(listener: (visible: boolean) => void): () => void;
}
