import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DesktopNative } from "./desktopNative.js";
import type { HostOpenFileMessage } from "@frostime/pi-client/host";
import { isAllowedFileReferencePath } from "@frostime/pi-client/shared/files/fileReferences";

type ReferencedLocation = Pick<HostOpenFileMessage, "path" | "line" | "column" | "endLine">;

// HTML and SVG can contain scripts, so they stay on the editor route along with source/config files.
const DEFAULT_APP_EXTENSIONS = new Set([".md", ".rst", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const DEFAULT_APP_FILENAMES = new Set(["authors", "changelog", "code_of_conduct", "contributing", "copying", "license", "readme", "security"]);

/**
 * Desktop uses the displayed Session cwd, never the foreground Project or process cwd.
 * Recognized code/config files go only to VS Code, not a potentially executing file association.
 * Missing targets fail rather than searching for a different file or creating one in an editor.
 */
export async function openReferencedLocation(reference: ReferencedLocation, cwd: string | undefined, native: Pick<DesktopNative, "openPath" | "openExternal">): Promise<void> {
  if (!reference.path.trim() || /[\0\r\n]/.test(reference.path)
    || (!isAbsolute(reference.path) && /^[a-z][a-z\d+.-]*:/i.test(reference.path))) {
    throw new Error("Only local file and directory paths can be opened.");
  }
  if (!isAbsolute(reference.path) && !cwd) throw new Error("A Session working directory is required to open a relative path.");
  const requestedPath = isAbsolute(reference.path) ? reference.path : resolve(cwd!, reference.path);
  let path: string;
  let isDirectory: boolean;
  try {
    path = await realpath(requestedPath);
    const target = await stat(path);
    isDirectory = target.isDirectory();
    if (!isDirectory && !target.isFile()) throw new Error("Not a regular file.");
  } catch {
    throw new Error("The linked file or directory does not exist or cannot be accessed.");
  }

  // Check both the reference and its real target: an allowed alias must not launch an executable.
  if (!isDirectory && (!isAllowedFileReferencePath(requestedPath) || !isAllowedFileReferencePath(path))) {
    throw new Error("This file type is not supported for Desktop links.");
  }
  if (isDirectory || DEFAULT_APP_EXTENSIONS.has(extname(path).toLowerCase()) || DEFAULT_APP_FILENAMES.has(basename(path).toLowerCase())) {
    const error = await native.openPath(path);
    if (error) throw new Error("Could not open the linked file or directory with its default application.");
    return;
  }

  // Build a file-only URI ourselves; renderer-supplied application protocols never reach the OS.
  const uri = new URL("vscode://file/");
  const fileUri = pathToFileURL(path);
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
