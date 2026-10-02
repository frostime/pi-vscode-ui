import {
  RPC_MAX_FRAME_BYTES,
  RPC_MAX_REASSEMBLED_BYTES,
} from "../../protocol/RpcChunkAssembler.js";
import type { RpcDialect } from "../RpcDialect.js";
import type { RpcEvent } from "../../protocol/rpcTypes.js";

const OMP_READY_PROTOCOL_VERSION = 1;

export const ohMyPiRpcDialect: RpcDialect = {
  requiresStartupReady: true,
  startupNegotiation: { type: "negotiate_protocol", protocolVersion: 2 },
  validateNegotiationResponse(data: unknown): void {
    if (typeof data !== "object" || data === null || Array.isArray(data) || (data as { protocolVersion?: unknown }).protocolVersion !== 2) {
      throw new Error("Oh My Pi RPC protocol v2 negotiation returned an invalid response");
    }
  },
  acceptStartupFrame(value: Record<string, unknown>): boolean {
    if (value.type !== "ready") return false;
    if (
      value.protocolVersion !== OMP_READY_PROTOCOL_VERSION ||
      !Array.isArray(value.supportedProtocolVersions) ||
      !value.supportedProtocolVersions.includes(2) ||
      value.maxFrameBytes !== RPC_MAX_FRAME_BYTES ||
      value.maxReassembledFrameBytes !== RPC_MAX_REASSEMBLED_BYTES
    ) {
      throw new Error("Oh My Pi RPC startup frame does not advertise the required protocol v2 transport");
    }
    return true;
  },
  normalizeEvent(event: RpcEvent): RpcEvent {
    if (event.type !== "session_settled") return event;
    return { ...event, type: "agent_settled" };
  },
};
