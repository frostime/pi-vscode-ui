import { get } from "svelte/store";
import { describe, expect, it } from "vitest";

import { applyComposerSeed } from "../../src/webview/features/composer/composerSeedClient.js";
import { composerDrafts, updateDraft } from "../../src/webview/features/composer/composerDraftStore.svelte.js";

describe("host-validated Composer seed", () => {
  it("applies each host-validated Composer seed once", () => {
    composerDrafts.set({ original: { text: "Unsent original", images: [] } });
    const session = {
      id: "fork-session",
      composerSeed: {
        id: "seed-1",
        text: "Retry this",
        images: [{ id: "image", name: "shot.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", size: 1 }],
      },
    } as never;

    expect(applyComposerSeed(session)).toBe(true);
    expect(get(composerDrafts).original?.text).toBe("Unsent original");
    expect(get(composerDrafts)["fork-session"]).toEqual({
      text: "Retry this",
      images: [{
        id: "image",
        name: "shot.png",
        mimeType: "image/png",
        data: "AA==",
        dataUrl: "data:image/png;base64,AA==",
        size: 1,
      }],
    });

    updateDraft("fork-session", (draft) => ({ ...draft, text: "Edited" }));
    expect(applyComposerSeed(session)).toBe(false);
    expect(get(composerDrafts)["fork-session"]?.text).toBe("Edited");
  });
});
