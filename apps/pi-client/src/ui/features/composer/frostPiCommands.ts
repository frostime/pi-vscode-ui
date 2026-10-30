import type { RpcCommandDescriptor } from "@frostime/pi-rpc";

export interface LocalComposerCommand {
  draft: "keep" | "clear" | { text: string };
  /** Runs after Composer applies the draft change. */
  execute(): void;
}

export interface LocalComposerCommands {
  completions(commands: RpcCommandDescriptor[]): RpcCommandDescriptor[];
  handle(input: { sessionId: string; text: string; hasImages: boolean }): LocalComposerCommand | undefined;
}

export const FROSTPI_COMPACT_COMMAND: RpcCommandDescriptor = {
  name: "compact", description: "Compact the current Pi context", source: "frostpi",
};
export const FROSTPI_RESUME_COMMAND: RpcCommandDescriptor = {
  name: "resume", description: "Open an existing Pi session for this workspace", source: "frostpi",
};

const FROSTPI_COMMANDS: readonly RpcCommandDescriptor[] = [FROSTPI_COMPACT_COMMAND, FROSTPI_RESUME_COMMAND];

export function withFrostPiCommands(
  commands: RpcCommandDescriptor[],
  localCommands: readonly RpcCommandDescriptor[] = FROSTPI_COMMANDS,
): RpcCommandDescriptor[] {
  return [
    ...localCommands,
    ...commands.filter((command) => !localCommands.some((local) => local.name === command.name)),
  ];
}
