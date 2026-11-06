import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DesktopProjectActionView } from "../shared/desktopBridge.js";
import { actionIsIncomplete, expandActionCommand, quotePowerShellLiteral, type DesktopCommandAction } from "../shared/desktopActions.js";

/** Tool detection input; injectable because the real probe depends on the machine's PATH. */
export interface ProjectActionEnvironment {
  PATH?: string;
  exists(path: string): Promise<boolean>;
}

/** Execution capabilities supplied by the Desktop shell. The root never comes from the renderer. */
export interface ProjectActionContext {
  readonly root: string;
  launch(executable: string, args: readonly string[]): Promise<void>;
  launchTerminal(command: string): Promise<void>;
  openPath(path: string): Promise<string>;
}

export interface ProjectAction {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly section?: "actions";
  /** Missing means always available. A throwing probe means unavailable, not a startup failure. */
  detect?(environment: ProjectActionEnvironment): Promise<boolean>;
  invoke(context: ProjectActionContext): Promise<void>;
}

interface ProjectActionDeps {
  // Property syntax: the registry hands these to actions, so they must not carry a `this` binding.
  launch: (executable: string, args: readonly string[]) => Promise<void>;
  openPath: (path: string) => Promise<string>;
  commands?: () => readonly DesktopCommandAction[];
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
  let lazygit: string | undefined;
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
    {
      id: "lazygit", label: "lazygit", icon: "codicon-globe", section: "actions",
      async detect(environment) {
        lazygit = await findExecutable(environment, ["lazygit.exe"]);
        return lazygit !== undefined;
      },
      async invoke(context) {
        if (!lazygit) throw new Error("lazygit is not available on this machine.");
        await context.launchTerminal(`& ${quotePowerShellLiteral(lazygit)}`);
      },
    },
  ];
}

/** The single owner of which Project actions exist, their menu order and their availability. */
export class ProjectActions {
  readonly #deps: ProjectActionDeps;
  readonly #actions: readonly ProjectAction[];
  readonly #enabled = new Set<string>();
  readonly #commands: () => readonly DesktopCommandAction[];
  #terminal: string | undefined;
  #shell: string | undefined;

  constructor(deps: ProjectActionDeps, actions: readonly ProjectAction[] = builtInActions()) {
    this.#deps = deps;
    this.#actions = [...actions];
    this.#commands = deps.commands ?? (() => []);
  }

  /** Probes every action once; availability is startup state, so later PATH changes are ignored. */
  async initialize(environment: ProjectActionEnvironment = defaultEnvironment()): Promise<void> {
    this.#enabled.clear();
    // Optional probes are independent: unavailable Windows Terminal must not hide a usable shell.
    this.#terminal = await findExecutable(environment, ["wt.exe"]).catch(() => undefined);
    this.#shell = await findExecutable(environment, ["pwsh.exe", "powershell.exe"]).catch(() => undefined);
    for (const action of this.#actions) {
      if (action.section === "actions" && !this.#shell) continue;
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
    const builtins: DesktopProjectActionView[] = this.#actions
      .filter((action) => this.#enabled.has(action.id))
      .map(({ id, label, icon, section }) => ({ id, label, icon, ...(section ? { section, scope: "global" as const } : {}) }));
    const saved = this.#commands();
    const ordered = [...saved.filter((command) => !command.projectId), ...saved.filter((command) => command.projectId)];
    const commands: DesktopProjectActionView[] = ordered.map(({ id, label, projectId }) => ({
      id: `custom:${id}`, label: label.trim() || "Unnamed Action", icon: projectId ? "codicon-folder" : "codicon-globe",
      section: "actions", scope: projectId ? "project" : "global", ...(projectId ? { projectId } : {}),
    }));
    return [...builtins, ...commands];
  }

  async run(id: unknown, root: string, projectId?: string): Promise<void> {
    if (typeof id === "string" && id.startsWith("custom:")) {
      const command = this.#commands().find((candidate) => candidate.id === id.slice("custom:".length));
      if (!command) throw new Error("This Action is no longer available.");
      if (command.projectId && command.projectId !== projectId) throw new Error("This Action belongs to a different Project.");
      // An unfinished Action is saved on purpose; refuse it here instead of blocking the settings file.
      if (actionIsIncomplete(command)) throw new Error("This Action has no command. Add one in Settings → Actions.");
      await this.#launchTerminal(root, command.command);
      return;
    }
    const action = typeof id === "string" ? this.#actions.find((candidate) => candidate.id === id) : undefined;
    if (!action) throw new Error(`Unknown Project action: ${String(id)}`);
    if (!this.#enabled.has(action.id)) throw new Error(`Project action "${action.id}" is not available on this machine.`);
    await action.invoke({ root, launch: this.#deps.launch, launchTerminal: (command) => this.#launchTerminal(root, command), openPath: this.#deps.openPath });
  }

  async #launchTerminal(root: string, command: string): Promise<void> {
    if (!this.#shell) {
      throw new Error("Terminal Actions require pwsh.exe or powershell.exe on PATH. Install PowerShell and restart FrostPi.");
    }
    // Encode both the directory setup and the user command. Windows Terminal parses semicolons
    // even inside child arguments; UTF-16LE Base64 keeps paths/commands out of its parser.
    const script = `Set-Location -LiteralPath ${quotePowerShellLiteral(root)} -ErrorAction Stop\n${expandActionCommand(command, root)}`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const shellArguments = ["-NoLogo", "-NoExit", "-EncodedCommand", encoded];
    // WT owns named-window creation/reuse. Direct launches leave console hosting to Windows.
    const executable = this.#terminal ?? this.#shell;
    const args = this.#terminal ? ["-w", "FrostPi", "new-tab", this.#shell, ...shellArguments] : shellArguments;
    try {
      await this.#deps.launch(executable, args);
    } catch {
      // Never retry the command or echo native errors: it may have side effects or contain secrets.
      throw new Error("Could not start the terminal for this Action.");
    }
  }
}
