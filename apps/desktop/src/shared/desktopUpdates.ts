/**
 * Update protocol shared by the renderer and the Desktop host.
 *
 * The renderer can express four actions and nothing else: no URL, file path,
 * signature, key or installer option crosses the bridge. The native update
 * owner decides the package and the installer; Node adds the Session
 * admission hint because it owns the Session set.
 */

export type DesktopUpdateActionType = "read" | "check" | "download" | "install";

export type DesktopUpdateAction = { type: DesktopUpdateActionType };

export type DesktopUpdateOperation = "idle" | "checking" | "downloading" | "preparingInstall";

export interface DesktopUpdateProgress {
  receivedBytes: number;
  totalBytes?: number;
}

/** State owned by the native update owner; it never includes Session admission. */
export interface DesktopUpdateNativeView {
  currentVersion: string;
  /** False when this build has no trusted update source, so checks cannot start. */
  configured: boolean;
  /** True once a check succeeded, even when it found no newer version; a failed check keeps the last value. */
  checked: boolean;
  available?: { version: string; notes?: string };
  /** A complete download on disk; installing uses this version, not `available`. */
  downloaded?: { version: string };
  operation: DesktopUpdateOperation;
  progress?: DesktopUpdateProgress;
  error?: string;
}

export type DesktopUpdateInstallBlock =
  | { reason: "sessions"; count: number }
  | { reason: "opening" };

/** Renderer projection: native state plus the host's authoritative Session block. */
export interface DesktopUpdateView extends DesktopUpdateNativeView {
  installBlock?: DesktopUpdateInstallBlock;
}

/** Node's answer to the native install-preparation request. */
export type DesktopUpdatePreparation =
  | { ok: true }
  | { ok: false; reason: "sessions"; count: number }
  | { ok: false; reason: "opening" };

const actionTypes: readonly string[] = ["read", "check", "download", "install"];
const operations: readonly string[] = ["idle", "checking", "downloading", "preparingInstall"];

/** An action carries exactly one known `type`; extra fields such as a path or URL are rejected. */
export function parseDesktopUpdateAction(value: unknown): DesktopUpdateAction | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "type") return undefined;
  const type = value.type;
  return typeof type === "string" && actionTypes.includes(type) ? { type: type as DesktopUpdateActionType } : undefined;
}

/**
 * Native views are validated on the private wire so a malformed packet cannot
 * add renderer-visible fields; `installBlock` belongs to Node, never to the shell.
 */
export function isDesktopUpdateNativeView(value: unknown): value is DesktopUpdateNativeView {
  if (!isRecord(value) || !hasOnlyKeys(value, ["currentVersion", "configured", "checked", "operation", "available", "downloaded", "progress", "error"])) return false;
  if (typeof value.currentVersion !== "string" || typeof value.configured !== "boolean" || typeof value.checked !== "boolean") return false;
  if (typeof value.operation !== "string" || !operations.includes(value.operation)) return false;
  if (value.error !== undefined && typeof value.error !== "string") return false;
  const available = value.available;
  if (available !== undefined && !(isRecord(available) && hasOnlyKeys(available, ["version", "notes"])
    && typeof available.version === "string" && (available.notes === undefined || typeof available.notes === "string"))) return false;
  const downloaded = value.downloaded;
  if (downloaded !== undefined && !(isRecord(downloaded) && hasOnlyKeys(downloaded, ["version"]) && typeof downloaded.version === "string")) return false;
  const progress = value.progress;
  if (progress !== undefined && !(isRecord(progress) && hasOnlyKeys(progress, ["receivedBytes", "totalBytes"])
    && isByteCount(progress.receivedBytes) && (progress.totalBytes === undefined || isByteCount(progress.totalBytes)))) return false;
  return true;
}

function isByteCount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
