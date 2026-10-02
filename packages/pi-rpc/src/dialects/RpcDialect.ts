import type { RpcCommand, RpcEvent } from "../protocol/rpcTypes.js";

export interface RpcDialect {
  /** Whether this runtime must send a startup frame before FrostPi sends commands. */
  readonly requiresStartupReady: boolean;
  /** Optional command sent after startup and before the initial get_state request. */
  readonly startupNegotiation?: RpcCommand;
  /** Validate the successful response to startupNegotiation. */
  validateNegotiationResponse?(data: unknown): void;
  /** Consume a dialect-specific startup frame. Returns true when the frame is complete. */
  acceptStartupFrame(value: Record<string, unknown>): boolean;
  /** Translate a runtime event into the Pi-shaped event contract. */
  normalizeEvent(event: RpcEvent): RpcEvent;
}
