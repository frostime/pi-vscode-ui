/** User-authored commands live only in Desktop settings; Project menus receive metadata, not commands. */
export interface DesktopCommandAction {
  id: string;
  label: string;
  command: string;
  /** Omitted means global. Project ids are Desktop identities, not filesystem paths. */
  projectId?: string;
}

/** An unfinished Action is the user's own draft: it may be saved, and it fails when run. */
export const desktopCommandActionSchema = {
  type: "object",
  required: ["id", "label", "command"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
    label: { type: "string", maxLength: 80, not: { pattern: "[\\u0000-\\u001f]" } },
    command: { type: "string", maxLength: 4096, not: { pattern: "\\u0000" } },
    projectId: { type: "string", minLength: 1 },
  },
} as const;

/** Saved but not runnable. Execution reports it; the settings file stays the user's own draft. */
export function actionIsIncomplete(action: DesktopCommandAction): boolean {
  return !action.label.trim() || !action.command.trim();
}

/** Shape is enforced by the settings schema; only identity that would make execution ambiguous is rejected. */
export function commandActionIssue(actions: readonly DesktopCommandAction[]): string | undefined {
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) return "Each Action must have a unique id.";
    ids.add(action.id);
  }
  return undefined;
}

/** Windows PowerShell treats ASCII and typographic apostrophes as single-quote delimiters. */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/['\u2018-\u201b]/gu, (quote) => quote + quote)}'`;
}

/** {{cwd}} is a complete argument. The callback preserves JavaScript replacement tokens in paths. */
export function expandActionCommand(command: string, cwd: string): string {
  return command.replaceAll("{{cwd}}", () => quotePowerShellLiteral(cwd));
}
