import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DesktopNative } from "./desktopNative.js";
import type { HostOpenFileMessage } from "@frostime/pi-client/host";
import { findWorkspaceFile } from "@frostime/pi-client/host/file-search/fallbackFileSearch";
import { isAllowedFileReferencePath } from "@frostime/pi-client/shared/files/fileReferences";

type ReferencedLocation = Pick<HostOpenFileMessage, "path" | "line" | "column" | "endLine">;

/**
 * Documents and media are shown by the program the user associated with them.
 * HTML and SVG join that group even though they can carry scripts: the default
 * browser or image viewer is a separate sandbox, unlike the Markdown SVG that
 * FrostPi sanitizes for its own webview. Source and configuration files stay on
 * the editor route along with unknown extensions.
 */
const DEFAULT_APP_EXTENSIONS = new Set([".htm", ".html", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".rst", ".svg", ".txt", ".webp"]);
const DEFAULT_APP_FILENAMES = new Set(["authors", "changelog", "code_of_conduct", "contributing", "copying", "license", "readme", "security"]);

interface ResolvedTarget {
  /** Real path after resolving links. */
  path: string;
  isDirectory: boolean;
}

/**
 * Desktop uses the displayed Session cwd, never the foreground Project or process cwd.
 * A reference that does not exist as given gets one best-effort fd lookup, then
 * the resolved candidate is validated again: matching a file must never relax
 * the whitelist. Recognized code/config files go only to VS Code, not a
 * potentially executing file association.
 */
export async function openReferencedLocation(reference: ReferencedLocation, cwd: string | undefined, native: Pick<DesktopNative, "openPath" | "openExternal">): Promise<void> {
  if (!reference.path.trim() || /[\0\r\n]/.test(reference.path)
    || (!isAbsolute(reference.path) && /^[a-z][a-z\d+.-]*:/i.test(reference.path))) {
    throw new Error("Only local file and directory paths can be opened.");
  }
  if (!isAbsolute(reference.path) && !cwd) throw new Error("A Session working directory is required to open a relative path.");
  const requestedPath = isAbsolute(reference.path) ? reference.path : resolve(cwd!, reference.path);

  const requested = await resolveTarget(requestedPath);
  if (requested) return openTarget(requested, reference, requestedPath, native);

  const match = await findWorkspaceFile(reference.path, cwd);
  if (match) {
    const matched = await resolveTarget(match);
    if (matched) return openTarget(matched, reference, match, native);
  }

  throw new Error("The linked file or directory does not exist or cannot be accessed.");
}

/** Resolves an existing candidate to its real target; undefined when it cannot be read. */
async function resolveTarget(candidate: string): Promise<ResolvedTarget | undefined> {
  try {
    const path = await realpath(candidate);
    const target = await stat(path);
    if (!target.isDirectory() && !target.isFile()) return undefined;
    return { path, isDirectory: target.isDirectory() };
  } catch {
    return undefined;
  }
}

async function openTarget(target: ResolvedTarget, reference: ReferencedLocation, candidate: string, native: Pick<DesktopNative, "openPath" | "openExternal">): Promise<void> {
  // Check both the requested path and its real target: an allowed alias must not launch an executable.
  if (!target.isDirectory && (!isAllowedFileReferencePath(candidate) || !isAllowedFileReferencePath(target.path))) {
    throw new Error("This file type is not supported for Desktop links.");
  }
  if (target.isDirectory || DEFAULT_APP_EXTENSIONS.has(extname(target.path).toLowerCase()) || DEFAULT_APP_FILENAMES.has(basename(target.path).toLowerCase())) {
    const error = await native.openPath(target.path);
    if (error) throw new Error("Could not open the linked file or directory with its default application.");
    return;
  }

  // Build a file-only URI ourselves; renderer-supplied application protocols never reach the OS.
  const uri = new URL("vscode://file/");
  const fileUri = pathToFileURL(target.path);
  uri.pathname = fileUri.host ? `//${fileUri.host}${fileUri.pathname}` : fileUri.pathname;
  // The external URI supports a position, not VS Code's native range selection.
  if (reference.line !== undefined) uri.pathname += `:${reference.line}:${reference.column ?? 1}`;
  try {
    await native.openExternal(uri.href);
  } catch {
    // Never fall back to openPath: the default association might run this script.
    throw new Error("Could not open this file in VS Code. Install VS Code and enable its vscode:// URL handler.");
  }
}
