import { BRIDGE_VERSION } from "$shared/bridge/bridgeVersion";
import type { HostToWebviewMessage } from "$shared/bridge/hostToWebview";
import type { ProviderUsageDescriptor, ProviderUsageResult } from "@frostime/provider-usage";
import { onHostMessage, postToHost } from "../../bridge/hostBridge";
import { createId } from "../../utils/createId";
import type { ProviderUsageSource } from "./providerUsageSource";

export const bridgeProviderUsageSource: ProviderUsageSource = {
  listProviders: (signal) => request("listUsageProviders", signal),
  queryUsage: (scope, signal) => request("queryProviderUsage", signal, scope),
};

function request(action: "listUsageProviders", signal: AbortSignal): Promise<readonly ProviderUsageDescriptor[]>;
function request(action: "queryProviderUsage", signal: AbortSignal, scope: string): Promise<readonly ProviderUsageResult[]>;
function request(action: "listUsageProviders" | "queryProviderUsage", signal: AbortSignal, scope?: string): Promise<readonly ProviderUsageDescriptor[] | readonly ProviderUsageResult[]> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const requestId = createId("provider-usage");
    const unsubscribe = onHostMessage((message: HostToWebviewMessage) => {
      if (message.bridgeVersion !== BRIDGE_VERSION || !("requestId" in message) || message.requestId !== requestId) return;
      if (message.type === "providerUsageError") {
        cleanup();
        reject(new Error("Provider usage request failed."));
      } else if (action === "listUsageProviders" && message.type === "usageProvidersResult") {
        cleanup();
        resolve(message.providers);
      } else if (action === "queryProviderUsage" && message.type === "providerUsageResult") {
        cleanup();
        resolve(message.results);
      }
    });
    function cleanup(): void {
      unsubscribe();
      signal.removeEventListener("abort", cancel);
    }
    function cancel(): void {
      cleanup();
      postToHost({ type: "cancelProviderUsage", requestId });
      reject(new Error("Provider usage request cancelled."));
    }
    signal.addEventListener("abort", cancel, { once: true });
    postToHost(action === "listUsageProviders"
      ? { type: action, requestId }
      : { type: action, requestId, scope: scope! });
  });
}
