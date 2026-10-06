export interface FileReference {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
}

export interface ParseFileReferenceOptions {
  /**
   * When true (default), only recognize paths whose final segment has a known
   * text-file extension or matches a common filename such as `Makefile` or
   * `LICENSE`. This avoids turning arbitrary dotted tokens like `v1.2.3` into
   * file links. Markdown links are parsed with this disabled because an explicit
   * `[text](href)` already signals user intent.
   */
  requireKnownExtension?: boolean;
}

const GITHUB_LOCATION_SUFFIX = /#L(\d+)(?:-L(\d+))?$/i;
const LINE_RANGE_SUFFIX = /:(\d+)-(\d+)$/;
const LOCATION_SUFFIX = /:(\d+)(?::(\d+))?$/;
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const ABSOLUTE_PATH = /^(?:[\\/]|[a-z]:[\\/])/i;
const EXPLICIT_RELATIVE_PATH = /^\.{1,2}[\\/]/;
const FILE_NAME = /(?:^|[\\/])(?:\.[^\s./\\]+|[^\s/\\]+\.[a-z][a-z\d._-]*)$/i;

/**
 * Known text-file extensions. Keeps the whitelist small and avoids matching
 * binaries, archives, or media files that happen to contain a dot.
 */
const ALLOWED_FILE_EXTENSIONS = new Set([
  "awk",
  "bash",
  "bib",
  "bst",
  "c",
  "cfg",
  "cc",
  "cls",
  "conf",
  "config",
  "cpp",
  "cs",
  "css",
  "cxx",
  "dtx",
  "erb",
  "fd",
  "fish",
  "fs",
  "fsi",
  "fsx",
  "go",
  "groovy",
  "h",
  "hh",
  "hpp",
  "htm",
  "html",
  "hxx",
  "ini",
  "ins",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lock",
  "log",
  "ltx",
  "lua",
  "md",
  "mdx",
  "mjs",
  "php",
  "pl",
  "pm",
  "properties",
  "ps1",
  "psd1",
  "psm1",
  "py",
  "pyi",
  "pyw",
  "rs",
  "rst",
  "sass",
  "scala",
  "scss",
  "sed",
  "sh",
  "sql",
  "sty",
  "svelte",
  "swift",
  "tex",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vb",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",

  // Binary Files
  "png",
  "jpg",
  "jpeg",
  "svg",
  "webp",
  "pdf"
]);

/**
 * Common filenames without an extension, plus dotfiles whose suffix is not in
 * the extension whitelist (e.g. `.env.local`). Case-insensitive.
 */
const ALLOWED_FILE_BASENAMES = new Set([
  "authors",
  "changelog",
  "code_of_conduct",
  "contributing",
  "copying",
  "cname",
  "dockerfile",
  "gemfile",
  "gemfile.lock",
  "gnumakefile",
  "license",
  "makefile",
  "rakefile",
  "readme",
  "security",
  ".babelrc",
  ".bashrc",
  ".browserslistrc",
  ".clang-format",
  ".clang-tidy",
  ".dockerignore",
  ".editorconfig",
  ".env",
  ".env.development",
  ".env.example",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.test",
  ".envrc",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".gitkeep",
  ".gitmodules",
  ".graphqlconfig",
  ".htaccess",
  ".inputrc",
  ".latexmkrc",
  ".mocharc",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  ".nycrc",
  ".python-version",
  ".prettierrc",
  ".sequelizerc",
  ".tool-versions",
  ".vimrc",
  ".yarnrc",
  ".zshrc",
]);

function fileBasename(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const lastBackslash = path.lastIndexOf("\\");
  return path.slice(Math.max(lastSlash, lastBackslash) + 1);
}

function isRecognizableFilePath(path: string): boolean {
  return FILE_NAME.test(path) || ALLOWED_FILE_BASENAMES.has(fileBasename(path).toLowerCase());
}

function hasAllowedFileSuffix(path: string): boolean {
  const basename = fileBasename(path);
  const lowerBasename = basename.toLowerCase();
  if (ALLOWED_FILE_BASENAMES.has(lowerBasename)) return true;

  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) return false;

  const extension = basename.slice(dotIndex + 1).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.has(extension);
}

export function parseFileReference(
  value: string,
  options: ParseFileReferenceOptions = {},
): FileReference | null {
  let path = value.trim();
  if (!path || /[\0\r\n]/.test(path)) return null;

  let line: number | undefined;
  let column: number | undefined;
  let endLine: number | undefined;
  const githubLocation = GITHUB_LOCATION_SUFFIX.exec(path);
  const lineRange = LINE_RANGE_SUFFIX.exec(path);
  const location = LOCATION_SUFFIX.exec(path);
  const suffix = githubLocation ?? lineRange ?? location;
  if (suffix) {
    line = Number(suffix[1]);
    if (suffix === location) column = suffix[2] === undefined ? undefined : Number(suffix[2]);
    else endLine = suffix[2] === undefined ? undefined : Number(suffix[2]);

    if (!Number.isSafeInteger(line) || line < 1) return null;
    if (column !== undefined && (!Number.isSafeInteger(column) || column < 1)) return null;
    if (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine < line)) return null;
    path = path.slice(0, suffix.index);
  }

  if (!path || /\s/.test(path)) return null;
  if (URI_SCHEME.test(path) && !WINDOWS_ABSOLUTE_PATH.test(path)) return null;
  if (!ABSOLUTE_PATH.test(path) && !EXPLICIT_RELATIVE_PATH.test(path) && !isRecognizableFilePath(path)) return null;
  if (options.requireKnownExtension !== false && !hasAllowedFileSuffix(path)) return null;

  return {
    path,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    ...(endLine === undefined ? {} : { endLine }),
  };
}

export function parseFileHref(href: string): FileReference | null {
  try {
    return parseFileReference(decodeURIComponent(href), { requireKnownExtension: false });
  } catch {
    return parseFileReference(href, { requireKnownExtension: false });
  }
}
