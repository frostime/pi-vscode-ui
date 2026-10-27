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
