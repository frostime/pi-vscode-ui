/** UTF-8 JSON body bytes, excluding the NDJSON newline; kept in sync with Rust MAX_FRAME. */
export const DESKTOP_MESSAGE_LIMIT_BYTES = 32 * 1024 * 1024;
export const DESKTOP_MESSAGE_LIMIT_ERROR = "Desktop messages are limited to 32 MiB. Reduce attachments or shorten the content.";
export const DESKTOP_TRANSPORT_BLOCKED_CHANNEL = "frostpi:transport:blocked";

/** Finite renderer-to-host routes. Native requests use a separate parent/child-only protocol. */
export const desktopRequestChannels = [
  "frostpi:client:in", "frostpi:projects:request", "frostpi:projects:add", "frostpi:projects:remove",
  "frostpi:projects:select", "frostpi:sidebar:set", "frostpi:dialog:response", "frostpi:resume:request",
  "frostpi:resume:show", "frostpi:resume:dismiss", "frostpi:settings:action", "frostpi:zoom",
] as const;

export interface DesktopRequest { channel: string; args: unknown[] }
export function isDesktopRequest(value: unknown): value is DesktopRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return typeof request.channel === "string" && (desktopRequestChannels as readonly string[]).includes(request.channel)
    && Array.isArray(request.args) && request.args.length <= 2;
}
