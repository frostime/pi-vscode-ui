import { writeSync } from "node:fs";
import { DesktopWire } from "./DesktopWire.js";
import { createDesktopBackend } from "./createDesktopBackend.js";
import type { DesktopNative, DesktopTransport } from "./desktopNative.js";
import { createDesktopPublisher } from "./publishDesktopEvent.js";
import { DESKTOP_MESSAGE_LIMIT_ERROR, isDesktopRequest } from "../shared/desktopTransport.js";

const wire = new DesktopWire(process.stdin, process.stdout);
const listeners = new Map<string, (...args: unknown[]) => void | Promise<void>>();
const handlers = new Map<string, (value: unknown) => Promise<unknown>>();
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextId = 0;
let focused = true;
let visible = true;
let visibility: ((value: boolean) => void) | undefined;
let backend: Awaited<ReturnType<typeof createDesktopBackend>> | undefined;
let starting: Promise<void> | undefined;
let closing = false;
const nativeCall = (operation: string, args: unknown[]): Promise<unknown> => new Promise((resolve, reject) => {
  if (closing) { reject(new Error("Desktop is closing.")); return; }
  const id = ++nextId; pending.set(id, { resolve, reject });
  if (!wire.send({ kind: "native", id, operation, args })) {
    pending.delete(id); reject(new Error(DESKTOP_MESSAGE_LIMIT_ERROR));
  }
});
const native: DesktopNative = {
  focused: () => focused,
  message: async (level, message) => { await nativeCall("message", [level, message]); },
  confirm: async (level, message, actions) => await nativeCall("confirm", [level, message, actions]) as string | undefined,
  openFiles: async (options) => await nativeCall("openFiles", [options]) as string[] | undefined,
  chooseDirectory: async () => await nativeCall("chooseDirectory", []) as string | undefined,
  writeClipboard: async (text) => { await nativeCall("writeClipboard", [text]); },
  openExternal: async (url) => { await nativeCall("openExternal", [url]); },
  openPath: async (path) => await nativeCall("openPath", [path]) as string,
  appearance: (theme, background, zoom) => { void nativeCall("appearance", [theme, background, zoom]).catch(() => undefined); },
};
const publisher = createDesktopPublisher(wire);
const transport: DesktopTransport = {
  publish: publisher.publish,
  listen: (channel, action) => { listeners.set(channel, action); return () => { listeners.delete(channel); }; },
  handle: (channel, action) => { handlers.set(channel, action); return () => { handlers.delete(channel); }; },
  visible: () => visible,
  onVisibility: (listener) => { visibility = listener; return () => { visibility = undefined; }; },
};
async function shutdown(id?: number): Promise<void> {
  if (closing) return;
  closing = true;
  for (const request of pending.values()) request.reject(new Error("Desktop is closing."));
  pending.clear();
  let ok = true;
  try { await starting; await backend?.dispose(); } catch { ok = false; }
  wire.send({ kind: "closed", id, ok });
  await wire.flush();
  process.exit(ok ? 0 : 1);
}
wire.on("disconnect", () => { void shutdown(); });
wire.on("packet", (packet: unknown) => {
  if (!packet || typeof packet !== "object") return;
  const message = packet as Record<string, unknown>;
  if (message.kind === "nativeResult" && typeof message.id === "number") {
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.ok === true) request?.resolve(message.value);
    else request?.reject(new Error("The native Desktop operation failed."));
    return;
  }
  if (message.kind === "close") { void shutdown(); return; }
  if (message.kind === "window") {
    focused = message.focused === true; visible = message.visible === true; visibility?.(visible); return;
  }
  if (message.kind === "init" && !starting && !closing) {
    starting = (async () => {
      if (typeof message.profile !== "string" || typeof message.version !== "string" || !Array.isArray(message.directories) || !message.directories.every((v) => typeof v === "string")) throw new Error("Invalid startup configuration.");
      backend = await createDesktopBackend({ profile: message.profile, artifacts: __dirname, clientVersion: message.version, directories: message.directories, native, transport });
      wire.send({ kind: "ready" });
    })().catch(() => { wire.send({ kind: "fatal", message: "FrostPi could not start. Existing settings were not reset." }); void shutdown(); });
    return;
  }
  if (message.kind !== "request" || closing || typeof message.id !== "number") return;
  const id = message.id;
  void (async () => {
    await starting;
    if (!backend || !isDesktopRequest(message.request)) throw new Error("Invalid Desktop request.");
    const { channel, args } = message.request;
    if (channel === "frostpi:client:in" && args[0] && typeof args[0] === "object" && "type" in args[0] && args[0].type === "ready") publisher.replay();
    const handler = handlers.get(channel);
    if (handler) return await handler(args[0]);
    const listener = listeners.get(channel);
    if (!listener) throw new Error("Unknown Desktop operation.");
    await listener(...args);
    return null;
  })().then((value) => {
    if (!wire.send({ kind: "response", id, ok: true, value })) wire.send({ kind: "response", id, ok: false });
  }, () => { wire.send({ kind: "response", id, ok: false }); });
});
// No prompt, frame content or native path is written to diagnostics.
process.on("uncaughtException", () => { writeSync(2, "FrostPi Desktop backend failed.\n"); void shutdown(); });
process.on("unhandledRejection", () => { writeSync(2, "FrostPi Desktop backend operation failed.\n"); });
