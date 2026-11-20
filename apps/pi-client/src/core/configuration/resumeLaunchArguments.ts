/**
 * Pi flags that choose the model for a conversation. In `frostpi.pi.arguments` they are
 * the default for new conversations; Pi would also apply them to a resumed session and
 * so override the model that session was using.
 */
const NEW_CONVERSATION_FLAGS = new Set(["--provider", "--model", "--thinking"]);

/**
 * The configured arguments for a launch. Resuming a saved Pi session drops the
 * model-selection flags, so Pi restores the model and thinking level the session had.
 * `--models`, which only scopes the picker, is kept. Only the Pi profile is adjusted;
 * other runtimes may give these flags another meaning.
 */
export function configuredLaunchArguments(
  args: readonly string[],
  resumesSession: boolean,
  runtimeCompatibility: string,
): string[] {
  if (!resumesSession || runtimeCompatibility !== "pi") return [...args];
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (NEW_CONVERSATION_FLAGS.has(arg) && index + 1 < args.length) {
      index += 1;
      continue;
    }
    kept.push(arg);
  }
  return kept;
}
