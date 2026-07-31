import type { CollectionDelta } from "../../shared/bridge/hostToWebview.js";

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
