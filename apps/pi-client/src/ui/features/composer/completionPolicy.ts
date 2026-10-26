import type { RpcCommandDescriptor } from "@frostime/pi-rpc";

export function promptCompletionConfigurationKey(
  sessionId: string,
  commands: readonly RpcCommandDescriptor[],
): string {
  return JSON.stringify([
    sessionId,
    commands.map((command) => [command.name, command.source]),
  ]);
}

export function shouldStartPromptCompletion(document: string, cursor: number): boolean {
  const boundedCursor = Math.max(0, Math.min(cursor, document.length));
  const lineStart = document.lastIndexOf("\n", boundedCursor - 1) + 1;
  const before = document.slice(lineStart, boundedCursor);
  return /^\s*\/[\w:#.-]*$/.test(before) || /(?:^|\s)@(?:"[^"\n]*|[^\s@]*)$/.test(before);
}
