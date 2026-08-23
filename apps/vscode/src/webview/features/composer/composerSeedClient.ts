import type { SessionViewModel } from "$shared/model/sessionViewModel";

import type { DraftImage } from "../../features/composer/composerDraftStore.svelte";
import { setDraft } from "./composerDraftSync";
import { composerFocusTick } from "../../state/sessionViewStore.svelte";

let appliedComposerSeedId: string | null = null;

export function applyComposerSeed(session: SessionViewModel | null): boolean {
  const seed = session?.composerSeed;
  if (!session || !seed || appliedComposerSeedId === seed.id) return false;
  appliedComposerSeedId = seed.id;
  setDraft(session.id, { text: seed.text, images: seed.images.map(seedImage) });
  composerFocusTick.update((value) => value + 1);
  return true;
}

function seedImage(image: NonNullable<SessionViewModel["composerSeed"]>["images"][number]): DraftImage {
  const prefix = `data:${image.mimeType};base64,`;
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType as DraftImage["mimeType"],
    data: image.dataUrl.slice(prefix.length),
    dataUrl: image.dataUrl,
    size: image.size,
  };
}
