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

const FROSTPI_COMMANDS: RpcCommandDescriptor[] = [
  { name: "compact", description: "Compact the current Pi context", source: "frostpi" },
  { name: "editor", description: "Edit the composer draft in a VS Code tab", source: "frostpi" },
  { name: "resume", description: "Open an existing Pi session for this workspace", source: "frostpi" },
];

export function withFrostPiCommands(commands: RpcCommandDescriptor[], includeResume = true): RpcCommandDescriptor[] {
  const localCommands = includeResume
    ? FROSTPI_COMMANDS
    : FROSTPI_COMMANDS.filter((command) => command.name !== "resume");
  return [
    ...localCommands,
    ...commands.filter((command) => !FROSTPI_COMMANDS.some((local) => local.name === command.name)),
  ];
}
