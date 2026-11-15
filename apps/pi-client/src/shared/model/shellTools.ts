/**
 * Pi's shell-command tools share one input shape (`command` plus an optional `timeout`) and one
 * card presentation, whichever shell the Host platform uses. Classifying them by name keeps live
 * and persisted tool views consistent. Matched case-insensitively, like `isElapsedTimerTool()`.
 */
const SHELL_TOOL_NAMES = ["bash", "powershell"];

export function isShellTool(name: string): boolean {
  return SHELL_TOOL_NAMES.includes(name.toLowerCase());
}
