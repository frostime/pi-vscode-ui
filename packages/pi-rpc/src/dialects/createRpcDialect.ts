import { ohMyPiRpcDialect } from "./ohMyPi/ohMyPiRpcDialect.js";
import { piRpcDialect } from "./pi/piRpcDialect.js";
import type { RpcDialect } from "./RpcDialect.js";

export type RpcRuntime = "pi" | "oh-my-pi";

export function createRpcDialect(runtime: RpcRuntime): RpcDialect {
  return runtime === "oh-my-pi" ? ohMyPiRpcDialect : piRpcDialect;
}
