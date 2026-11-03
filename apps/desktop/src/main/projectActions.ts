import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DesktopProjectActionView } from "../shared/desktopBridge.js";

/** Tool detection input; injectable because the real probe depends on the machine's PATH. */
export interface ProjectActionEnvironment {
  PATH?: string;
  exists(path: string): Promise<boolean>;
}

/** Execution capabilities supplied by the Desktop shell. The root never comes from the renderer. */
export interface ProjectActionContext {
  readonly root: string;
  launch(executable: string, args: readonly string[]): Promise<void>;
  openPath(path: string): Promise<string>;
}

export interface ProjectAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  /** Missing means always available. A throwing probe means unavailable, not a startup failure. */
  detect?(environment: ProjectActionEnvironment): Promise<boolean>;
  invoke(context: ProjectActionContext): Promise<void>;
}

interface ProjectActionDeps {
  // Property syntax: the registry hands these to actions, so they must not carry a `this` binding.
  launch: (executable: string, args: readonly string[]) => Promise<void>;
  openPath: (path: string) => Promise<string>;
}

interface ToolActionDefinition {
  id: string;
  /** Product name used in failure messages, independent of the menu label wording. */
  tool: string;
  label: string;
  icon: string;
  /** Order is preference: an earlier name wins over an earlier directory. */
  candidates: readonly string[];
  arguments(root: string): string[];
}

/** Windows Store app aliases fail `stat` with EACCES yet still launch, so probe with `access`. */
function defaultEnvironment(): ProjectActionEnvironment {
  return {
    PATH: process.env.PATH ?? "",
    async exists(path) {
      try {
        await access(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function findExecutable(
  environment: ProjectActionEnvironment,
  candidates: readonly string[],
): Promise<string | undefined> {
  const directories = (environment.PATH ?? "")
    .split(";")
    .map((directory) => directory.trim().replace(/^"(.*)"$/u, "$1"))
    .filter((directory) => directory.length > 0);
  for (const candidate of candidates) {
    for (const directory of directories) {
      // Absolute, so the shell never runs a second PATH search of its own.
      const path = resolve(join(directory, candidate));
      if (await environment.exists(path)) return path;
    }
  }
  return undefined;
}

/** One action that launches a resolved tool. Only its own `detect` writes the resolution. */
function toolAction(definition: ToolActionDefinition): ProjectAction {
  let executable: string | undefined;
  return {
    id: definition.id,
    label: definition.label,
    icon: definition.icon,
    async detect(environment) {
      executable = await findExecutable(environment, definition.candidates);
      return executable !== undefined;
    },
    async invoke(context) {
      if (!executable) throw new Error(`${definition.tool} is not available on this machine.`);
      try {
        await context.launch(executable, definition.arguments(context.root));
      } catch {
        // The native transport cannot carry the Windows error code, so name the tool instead.
        throw new Error(`Could not start ${definition.tool}.`);
      }
    },
  };
}

/** Built per registry instance: each closure holds that instance's detection result. */
function builtInActions(): ProjectAction[] {
  return [
    {
      id: "reveal",
      label: "Open in File Explorer",
      icon: "codicon-folder-opened",
      async invoke(context) {
        const error = await context.openPath(context.root);
        if (error) throw new Error(error);
      },
    },
    toolAction({
      id: "vscode",
      tool: "VS Code",
      label: "Open in VS Code",
      icon: "codicon-vscode",
      // Only the `code.cmd` shim implements the CLI flags; `Code.exe` ignores `-n`.
      // The shim is parsed by cmd, so arguments are quoted and a `%NAME%` pair in a path
      // cannot be passed through intact.
      candidates: ["code.cmd", "code.exe"],
      arguments: (root) => ["-n", root],
    }),
    toolAction({
      id: "zed",
      tool: "Zed",
      label: "Open in Zed",
      icon: "codicon-zap",
      candidates: ["zed.exe"],
      arguments: (root) => ["-n", root],
    }),
    toolAction({
      id: "terminal",
      tool: "Windows Terminal",
      label: "Open in Windows Terminal",
      icon: "codicon-terminal",
      candidates: ["wt.exe"],
      arguments: (root) => ["-d", root],
    }),
  ];
}

/** The single owner of which Project actions exist, their menu order and their availability. */
export class ProjectActions {
  readonly #deps: ProjectActionDeps;
  readonly #actions: readonly ProjectAction[];
  readonly #enabled = new Set<string>();

  constructor(deps: ProjectActionDeps, actions: readonly ProjectAction[] = builtInActions()) {
    this.#deps = deps;
    this.#actions = [...actions];
  }

  /** Probes every action once; availability is startup state, so later PATH changes are ignored. */
  async initialize(environment: ProjectActionEnvironment = defaultEnvironment()): Promise<void> {
    this.#enabled.clear();
    for (const action of this.#actions) {
      let available = true;
      if (action.detect) {
        try {
          available = await action.detect(environment);
        } catch {
          available = false;
        }
      }
      if (available) this.#enabled.add(action.id);
    }
  }

  get view(): DesktopProjectActionView[] {
    return this.#actions
      .filter((action) => this.#enabled.has(action.id))
      .map(({ id, label, icon }) => ({ id, label, icon }));
  }

  async run(id: unknown, root: string): Promise<void> {
    const action = typeof id === "string" ? this.#actions.find((candidate) => candidate.id === id) : undefined;
    if (!action) throw new Error(`Unknown Project action: ${String(id)}`);
    if (!this.#enabled.has(action.id)) throw new Error(`Project action "${action.id}" is not available on this machine.`);
    await action.invoke({ root, launch: this.#deps.launch, openPath: this.#deps.openPath });
  }
}
