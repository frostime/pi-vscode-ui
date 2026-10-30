import type { StreamingBehavior } from "@frostime/pi-rpc";
import { writable } from "svelte/store";

const selections = writable<Record<string, StreamingBehavior>>({});
export { selections as composerStreamingBehaviors };

export function setComposerStreamingBehavior(sessionId: string, behavior: StreamingBehavior): void {
  selections.update((current) => ({ ...current, [sessionId]: behavior }));
}
