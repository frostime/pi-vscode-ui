import type { RpcCommandDescriptor } from "@frostime/pi-rpc";

import type { RuntimeCapabilities } from "../configuration/runtimeCompatibility.js";
import { normalizePiSlashPrompt } from "./normalizePiSlashPrompt.js";

/** Slash commands FrostPi answers itself instead of submitting them to the runtime. */
export type HostCommand =
  | { name: "compact" | "btw"; argument: string }
  | { name: "clear" | "rewind"; argument: "" };

/**
 * `/clear` and `/rewind` take no argument, so text after either stays an ordinary
 * prompt for the runtime; `/compact` and `/btw` own everything after their name.
 */
export function parseHostCommand(text: string): HostCommand | null {
  const normalized = normalizePiSlashPrompt(text);
  if (normalized === "/clear") return { name: "clear", argument: "" };
  if (normalized === "/rewind") return { name: "rewind", argument: "" };
  for (const name of ["compact", "btw"] as const) {
    if (normalized === `/${name}`) return { name, argument: "" };
    if (normalized.startsWith(`/${name} `)) return { name, argument: normalized.slice(name.length + 2).trim() };
  }
  return null;
}

/** What a Host needs, besides the runtime profile, to answer the gated commands. */
export interface HostCommandSupport {
  capabilities: RuntimeCapabilities;
  sessionTreeAdapter: boolean;
  sideQuestionAdapter: boolean;
}

/**
 * A command the Host cannot answer for this runtime is not intercepted: its text goes
 * to the runtime, where a same-named command of the user's own keeps working.
 */
export function answersHostCommand(name: HostCommand["name"], support: HostCommandSupport): boolean {
  switch (name) {
    case "compact":
      return true;
    case "clear":
      return support.capabilities.newSession;
    case "rewind":
      return support.capabilities.sessionTree && support.sessionTreeAdapter;
    case "btw":
      return support.capabilities.sideQuestion && support.sideQuestionAdapter;
  }
}

const GATED_COMMANDS: readonly (RpcCommandDescriptor & { name: HostCommand["name"] })[] = [
  { name: "clear", description: "Start a new conversation here; the current one stays resumable", source: "frostpi" },
  { name: "rewind", description: "Go back to an earlier prompt in this conversation", source: "frostpi" },
  { name: "btw", description: "Ask a side question that is not added to the conversation", source: "frostpi" },
];

/**
 * The Session's command list as the user sees it: the Host commands this runtime
 * supports, then the runtime's own commands, minus any the Host command shadows.
 * `/compact` is not listed here; every product offers it in its static list.
 */
export function withHostCommands(commands: readonly RpcCommandDescriptor[], support: HostCommandSupport): RpcCommandDescriptor[] {
  const offered = GATED_COMMANDS.filter((command) => answersHostCommand(command.name, support));
  return [...offered, ...commands.filter((command) => !offered.some((host) => host.name === command.name))];
}
