import {
  RPC_MAX_FRAME_BYTES,
  RPC_MAX_REASSEMBLED_BYTES,
} from "../../protocol/RpcChunkAssembler.js";
import type { RpcDialect } from "../RpcDialect.js";
import type { RpcCommand, RpcEvent } from "../../protocol/rpcTypes.js";

export const ohMyPiRpcDialect: RpcDialect = {
  requiresStartupReady: true,
  getStartupNegotiation(frame: Record<string, unknown>): RpcCommand | undefined {
    if (
      Array.isArray(frame.supportedProtocolVersions) &&
      frame.supportedProtocolVersions.includes(2) &&
      frame.maxFrameBytes === RPC_MAX_FRAME_BYTES &&
      frame.maxReassembledFrameBytes === RPC_MAX_REASSEMBLED_BYTES
    ) {
      return { type: "negotiate_protocol", protocolVersion: 2 };
    }
    return undefined;
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
