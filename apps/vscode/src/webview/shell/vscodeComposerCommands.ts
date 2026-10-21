import { get } from "svelte/store";

import { postToHost } from "$ui/bridge/hostBridge";
import { composerEditorPrefill } from "$ui/features/composer/editorCommand";
import { withFrostPiCommands, type LocalComposerCommands } from "$ui/features/composer/frostPiCommands";
import { presentationStore, showToast } from "$ui/state/sessionViewStore.svelte";

function allowResume(): boolean {
  // The panel surface never offers session resuming; the sidebar owns it.
  return get(presentationStore).surface.kind !== "panel";
}

export function createVsCodeComposerCommands(
  /** Overridable for tests; entries use the presentation surface. */
  { allowResume: allowResumeOverride }: { allowResume?: () => boolean } = {},
): LocalComposerCommands {
  const resumeAllowed = allowResumeOverride ?? allowResume;
  return {
    completions: (commands) => withFrostPiCommands(commands, resumeAllowed()),
    handle({ sessionId, text, hasImages }) {
      if (!hasImages && text.trim() === "/resume") {
        return resumeAllowed()
          ? { draft: "clear", execute: () => postToHost({ type: "resumeSession" }) }
          : { draft: "keep", execute: () => showToast("info", "Open the FrostPi sidebar to resume a session.") };
      }
      const prefill = composerEditorPrefill(text);
      if (prefill !== null) {
        return {
          draft: { text: prefill },
          execute: () => postToHost({ type: "openComposerEditor", sessionId, text: prefill }),
        };
      }
      return undefined;
    },
  };
}
