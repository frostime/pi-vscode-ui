import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { RpcCommandDescriptor } from "@frostime/pi-rpc";

export function commandCompletion(commands: readonly RpcCommandDescriptor[]): CompletionSource {
  let previousOptions = new Map<string, Completion>();

  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\/[\w:#.-]*/);
    if (!match) return null;
    const line = context.state.doc.lineAt(match.from);
    if (line.text.slice(0, match.from - line.from).trim().length > 0) return null;

    const nextOptions = new Map<string, Completion>();
    const options = commands.map((command) => {
      const key = JSON.stringify([command.name, command.source]);
      const option = previousOptions.get(key) ?? {
        label: `/${command.name}`,
        detail: command.source,
        apply: `/${command.name} `,
      };
      nextOptions.set(key, option);
      return option;
    });
    previousOptions = nextOptions;
    return { from: match.from, options, validFor: /^\/[\w:#.-]*$/ };
  };
}
