import type { RpcDialect, RpcStartupNegotiation } from "../RpcDialect.js";
import type { RpcEvent } from "../../protocol/rpcTypes.js";
import { RPC_MAX_FRAME_BYTES, RPC_MAX_REASSEMBLED_BYTES } from "../../protocol/RpcChunkAssembler.js";

export const ohMyPiRpcDialect: RpcDialect = {
  requiresStartupReady: true,
  getStartupNegotiation(frame: Record<string, unknown>): RpcStartupNegotiation | undefined {
    if (!Array.isArray(frame.supportedProtocolVersions) || !frame.supportedProtocolVersions.includes(2)) return undefined;

    // Negotiate by protocol support, not equality with the current OMP defaults. Use the peer's
    // advertised ceilings for this connection so changed limits do not silently select v1 or
    // reject otherwise valid history. Missing ceilings use the baseline v2 contract; malformed
    // advertised values fail explicitly rather than disguising the problem as a v1 fallback.
    return {
      command: { type: "negotiate_protocol", protocolVersion: 2 },
      chunkLimits: {
        maxFrameBytes: readFrameLimit(frame.maxFrameBytes, RPC_MAX_FRAME_BYTES),
        maxReassembledFrameBytes: readFrameLimit(frame.maxReassembledFrameBytes, RPC_MAX_REASSEMBLED_BYTES),
      },
    };
  },
  validateNegotiationResponse(data: unknown): void {
    if (typeof data !== "object" || data === null || Array.isArray(data) || (data as { protocolVersion?: unknown }).protocolVersion !== 2) {
      throw new Error("Oh My Pi RPC protocol v2 negotiation returned an invalid response");
    }
  },
  acceptStartupFrame(value: Record<string, unknown>): boolean {
    return value.type === "ready";
  },
  normalizeEvent(event: RpcEvent): RpcEvent {
    if (event.type !== "session_settled") return event;
    return { ...event, type: "agent_settled" };
  },
};

function readFrameLimit(value: unknown, baseline: number): number {
  if (value === undefined) return baseline;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Oh My Pi RPC ready frame contains an invalid byte limit");
  }
  return value;
}
