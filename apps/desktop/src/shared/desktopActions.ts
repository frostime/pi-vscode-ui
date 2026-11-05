/** User-authored commands live only in Desktop settings; Project menus receive metadata, not commands. */
export interface DesktopCommandAction {
  id: string;
  label: string;
  command: string;
  /** Omitted means global. Project ids are Desktop identities, not filesystem paths. */
  projectId?: string;
}

export const desktopCommandActionSchema = {
  type: "object",
  required: ["id", "label", "command"],
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
    label: { type: "string", minLength: 1, maxLength: 80, pattern: "\\S", not: { pattern: "[\\u0000-\\u001f]" } },
    command: { type: "string", minLength: 1, maxLength: 4096, pattern: "\\S", not: { pattern: "\\u0000" } },
    projectId: { type: "string", minLength: 1 },
  },
} as const;

export function isActionLabelValid(label: string): boolean {
  return Boolean(label.trim()) && label.length <= 80
    && !Array.from(label).some((character) => character.charCodeAt(0) < 0x20);
}

/** Shape is validated at the settings boundary; ids must also be unique across both scopes. */
export function commandActionIssue(actions: readonly DesktopCommandAction[]): string | undefined {
  const ids = new Set<string>();
  for (const action of actions) {
    if (ids.has(action.id)) return "Each Action must have a unique id.";
    if (!action.label.trim()) return "Enter a name for each Action.";
    if (!action.command.trim()) return "Enter a shell command for each Action.";
    if (!isActionLabelValid(action.label)) return "Action names must be at most 80 characters and contain no control characters.";
    if (action.command.length > 4096 || action.command.includes("\0")) return "Action commands must be at most 4096 characters and contain no null characters.";
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
