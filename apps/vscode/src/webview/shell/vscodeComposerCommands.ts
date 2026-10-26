import type { RpcCommandDescriptor } from "@frostime/pi-rpc";
import { get } from "svelte/store";

import { postToHost } from "$ui/bridge/hostBridge";
import { composerEditorPrefill } from "$ui/features/composer/editorCommand";
import {
  FROSTPI_COMPACT_COMMAND, FROSTPI_RESUME_COMMAND, withFrostPiCommands, type LocalComposerCommands,
} from "$ui/features/composer/frostPiCommands";
import { presentationStore, showToast } from "$ui/state/sessionViewStore.svelte";

const VSCODE_COMPOSER_COMMANDS: readonly RpcCommandDescriptor[] = [
  FROSTPI_COMPACT_COMMAND,
  { name: "editor", description: "Edit the composer draft in a VS Code tab", source: "frostpi" },
  FROSTPI_RESUME_COMMAND,
];

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
    completions(commands) {
      const completions = withFrostPiCommands(commands, VSCODE_COMPOSER_COMMANDS);
      // Panel handling still owns /resume, so hide it only after replacing same-named Pi commands.
      return resumeAllowed() ? completions : completions.filter((command) => command.name !== "resume");
    },
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
