import type { RpcDialect } from "../RpcDialect.js";
import type { RpcEvent } from "../../protocol/rpcTypes.js";

export const piRpcDialect: RpcDialect = {
  requiresStartupReady: false,
  acceptStartupFrame: () => false,
  normalizeEvent: (event: RpcEvent) => event,
};
