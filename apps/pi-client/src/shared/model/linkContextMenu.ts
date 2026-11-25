/**
 * Context a link in a message hands to VS Code's webview context menu through
 * `data-vscode-context`. The manifest's `webview/context` entries match these
 * section names, and their commands read the target from `LINK_TARGET_KEY`.
 */
export const WEB_LINK_SECTION = "frostpiWebLink";
export const FILE_LINK_SECTION = "frostpiFileLink";
export const LINK_TARGET_KEY = "frostpiLinkTarget";

export type LinkContextSection = typeof WEB_LINK_SECTION | typeof FILE_LINK_SECTION;

/** The link target a context-menu command received, or undefined when the argument is not a FrostPi link. */
export function linkTargetFromContext(context: unknown, section: LinkContextSection): string | undefined {
  if (typeof context !== "object" || context === null) return undefined;
  const record = context as Record<string, unknown>;
  const target = record[LINK_TARGET_KEY];
  return record["webviewSection"] === section && typeof target === "string" && target.length > 0 ? target : undefined;
}
