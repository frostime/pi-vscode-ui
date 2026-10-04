import type { RpcCommandDescriptor } from "../../protocol/rpcTypes.js";

/** FrostPi's bounded OMP surface: text-expanding Markdown commands and skills only. */
export function ompCommandDescriptors(value: unknown): RpcCommandDescriptor[] {
  if (!Array.isArray(value)) throw new Error("Oh My Pi command discovery did not return a command list");
  const commands = value.filter(isCommandDescriptor);
  const builtinNames = new Set<string>();
  const handlerNames = new Set<string>();
  for (const command of commands) {
    if (command.source === "builtin") {
      builtinNames.add(command.name);
      if (Array.isArray(command.aliases)) {
        for (const alias of command.aliases) if (typeof alias === "string") builtinNames.add(alias);
      }
    }
    if (command.source !== "file" && command.source !== "skill") handlerNames.add(command.name);
  }

  return commands.flatMap<RpcCommandDescriptor>((command) => {
    // All parsers require one leading slash and a single-token command name.
    if (!command.name || command.name.startsWith("/") || /\s/u.test(command.name)) return [];
    if (command.source === "skill") {
      return command.name.startsWith("skill:") && command.name.length > "skill:".length
        ? [{ ...command, runtimeSource: "skill" }]
        : [];
    }
    if (command.source !== "file") return [];
    // RPC checks skills and builtins before file expansion. Builtins additionally parse
    // ':' as a separator, unlike the file-command parser (e.g. /model:foo).
    const prefix = command.name.split(":", 1)[0]!;
    if (command.name.startsWith("skill:") || builtinNames.has(prefix) || handlerNames.has(command.name)) return [];
    return [{ ...command, source: "prompt", runtimeSource: "file" }];
  });
}

function isCommandDescriptor(value: unknown): value is RpcCommandDescriptor {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as RpcCommandDescriptor).name === "string"
    && typeof (value as RpcCommandDescriptor).source === "string";
}
