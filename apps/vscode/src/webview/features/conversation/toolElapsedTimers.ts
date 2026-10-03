import { formatTurnDuration } from "./collapseTurnTrace";

export { formatTurnDuration };

/**
 * Tools whose runs are long enough that a live elapsed readout replaces the breathing
 * status dot on the card header. The list is a presentational contract, not behavior:
 * everything outside it is expected to finish in the time a dot takes to breathe twice,
 * so those cards stay quiet. Matched against the tool name Pi reports, case-insensitively.
 */
export const ELAPSED_TIMER_TOOLS = new Set(["bash", "powershell", "codemode"]);

export function isElapsedTimerTool(name: string): boolean {
  return ELAPSED_TIMER_TOOLS.has(name.toLowerCase());
}
