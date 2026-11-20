import type { CollectionDelta, ConversationDelta, TurnPatch } from "../../shared/bridge/hostToWebview.js";
import type { ConversationItemView } from "../../shared/model/conversationModel.js";

interface Identified {
  id: string;
}

export function collectionDelta<T extends Identified>(
  previousOrder: readonly string[],
  previousRefs: ReadonlyMap<string, T>,
  current: readonly T[],
): CollectionDelta<T> {
  const currentOrder = current.map((item) => item.id);
  const isAppendOnly = previousOrder.length <= currentOrder.length
    && previousOrder.every((id, index) => currentOrder[index] === id);
  if (!isAppendOnly) return { mode: "replace", items: [...current] };
  return {
    mode: "upsert",
    items: current.filter((item) => previousRefs.get(item.id) !== item),
  };
}

/** Like `collectionDelta`, but a changed turn the Webview already has becomes a patch of its changed items. */
export function conversationDelta(
  previousOrder: readonly string[],
  previousRefs: ReadonlyMap<string, ConversationItemView>,
  current: readonly ConversationItemView[],
): ConversationDelta {
  const delta = collectionDelta(previousOrder, previousRefs, current);
  if (delta.mode === "replace") return delta;
  const items: ConversationItemView[] = [];
  const turnPatches: TurnPatch[] = [];
  for (const item of delta.items) {
    const previous = previousRefs.get(item.id);
    if (item.type !== "turn" || previous?.type !== "turn") {
      items.push(item);
      continue;
    }
    const { items: turnItems, ...turn } = item;
    turnPatches.push({
      turn,
      items: collectionDelta(
        previous.items.map((turnItem) => turnItem.id),
        new Map(previous.items.map((turnItem) => [turnItem.id, turnItem])),
        turnItems,
      ),
    });
  }
  return turnPatches.length > 0 ? { mode: "upsert", items, turnPatches } : { mode: "upsert", items };
}
