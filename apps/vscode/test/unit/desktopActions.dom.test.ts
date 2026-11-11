import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SettingsPanel from "../../../desktop/src/renderer/SettingsPanel.svelte";
import DesktopShell from "../../../desktop/src/renderer/DesktopShell.svelte";
import type { DesktopCommandAction } from "../../../desktop/src/shared/desktopActions.js";
import type { DesktopProject, DesktopProjectsView } from "../../../desktop/src/shared/desktopBridge.js";
import type { DesktopSettingsAction, DesktopSettingsView } from "../../../desktop/src/shared/desktopSettings.js";

const projects: DesktopProject[] = [
  { id: "alpha", name: "Alpha", cwd: "C:\\Projects\\Alpha" },
  { id: "beta", name: "Beta", cwd: "C:\\Projects\\Beta's tools; safe" },
];
const configured: DesktopCommandAction[] = [
  { id: "global", label: "Global tool", command: "global-tool --root {{cwd}}" },
  { id: "alpha-task", label: "Alpha task", command: "alpha-tool", projectId: "alpha" },
  { id: "beta-task", label: "Beta task", command: "beta-tool", projectId: "beta" },
];
const settings: DesktopSettingsView = {
  values: { "desktop.actions": configured }, filePath: "C:\\Profile\\settings.json", firstRun: false, notices: [],
};
const projectAction = vi.fn();
const browserMethods: Array<() => void> = [];

beforeAll(() => {
  // jsdom lacks native dialog and scrolling APIs; only their browser lifecycle is supplied.
  for (const [prototype, key, implementation] of [
    [HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) { this.open = true; }],
    [HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) { this.open = false; }],
    [HTMLElement.prototype, "scrollIntoView", () => undefined],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(prototype, key);
    Object.defineProperty(prototype, key, { configurable: true, value: implementation });
    browserMethods.push(() => {
      if (original) Object.defineProperty(prototype, key, original);
      else Reflect.deleteProperty(prototype, key);
    });
  }
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("frostpiDesktop", { projectAction });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  projectAction.mockClear();
});
afterAll(() => {
  browserMethods.forEach((restore) => restore());
  vi.unstubAllGlobals();
});

function mountSettings(target?: "desktop.actions") {
  const onaction = vi.fn((action: DesktopSettingsAction): Promise<DesktopSettingsView> =>
    Promise.resolve(action.type === "save" ? { ...settings, values: action.values } : settings));
  const view = render(SettingsPanel, { props: {
    view: settings, projects, ...(target ? { target } : {}), busy: false, updateView: null,
    onaction, onupdate: vi.fn(), onclose: vi.fn(),
  } });
  const categories = within(view.getByRole("navigation", { name: "Settings categories" }));
  return { ...view, categories, onaction };
}

/** Entering the page opens and focuses the first Action; wait for that before interacting. */
async function settle(view: ReturnType<typeof mountSettings>): Promise<void> {
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("textbox", { name: "Name" })));
}

async function editAction(view: ReturnType<typeof mountSettings>, row: RegExp, label: string, command: string): Promise<void> {
  const button = view.getByRole("button", { name: row });
  if (button.getAttribute("aria-expanded") !== "true") await fireEvent.click(button);
  await fireEvent.input(view.getByRole("textbox", { name: "Name" }), { target: { value: label } });
  await fireEvent.input(view.getByRole("textbox", { name: "Command" }), { target: { value: command } });
}

describe("Desktop Actions settings", () => {
  it("keeps Global and Project drafts across categories, search and external updates until Save", async () => {
    const view = mountSettings("desktop.actions");
    await settle(view);
    const globalCommand = "global-tool --token sensitive-global {{cwd}}";
    const betaCommand = "beta-tool --token sensitive-beta {{cwd}}";
    await editAction(view, /^Global tool/, "Shared edited", globalCommand);
    await editAction(view, /^Beta task/, "Beta edited", betaCommand);
    // Unfinished input survives leaving the category and an external view update.
    await fireEvent.click(view.categories.getByRole("button", { name: /^Appearance/ }));
    await view.rerender({ view: { ...settings, values: { ...settings.values, "desktop.theme": "light", "desktop.zoomFactor": 1.2 } } });
    await fireEvent.click(view.categories.getByRole("button", { name: /^Actions/ }));
    expect(view.getByRole("button", { name: /^Beta edited/ })).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: /^Beta edited/ }));
    expect((view.getByRole("textbox", { name: "Command" }) as HTMLTextAreaElement).value).toBe(betaCommand);
    await fireEvent.input(view.getByRole("searchbox", { name: "Search settings" }), { target: { value: "desktop.actions" } });
    expect(view.getByRole("button", { name: /^Shared edited/ })).toBeTruthy();
    // Commands may contain credentials, so the change summary never quotes them.
    await fireEvent.click(view.getByRole("button", { name: "Review changes" }));
    const review = view.getByRole("region", { name: "Unsaved setting changes" });
    expect(review.textContent).toContain("Custom Actions");
    expect(review.textContent).not.toContain("sensitive-");
    expect(view.onaction).not.toHaveBeenCalled();
    expect(projectAction).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(view.onaction).toHaveBeenCalledExactlyOnceWith({
      type: "save", values: {
        "desktop.theme": "light", "desktop.zoomFactor": 1.2,
        "desktop.actions": [
          { ...configured[0], label: "Shared edited", command: globalCommand },
          { ...configured[1], label: "Alpha task", command: "alpha-tool" },
          { ...configured[2], label: "Beta edited", command: betaCommand },
        ],
      },
    }));
    expect(projectAction).not.toHaveBeenCalled();
  });

  it("saves an unfinished Action as a draft and keeps its identity through delete and Discard", async () => {
    const view = mountSettings("desktop.actions");
    await settle(view);
    await fireEvent.click(within(view.getByRole("region", { name: "Global Actions" })).getByRole("button", { name: "Add" }));
    // Only a missing command makes an Action unrunnable, so a name-less draft is saved.
    await fireEvent.input(view.getByRole("textbox", { name: "Command" }), { target: { value: "new-tool" } });
    await fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(view.onaction).toHaveBeenCalledTimes(1));
    const save = view.onaction.mock.calls[0]![0];
    expect(save.type).toBe("save");
    if (save.type !== "save") throw new Error("Expected settings Save");
    const added = (save.values["desktop.actions"] as DesktopCommandAction[]).find((action) => action.command === "new-tool")!;
    expect(added.label).toBe("");
    expect(added.id).toMatch(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u);
    expect(added.projectId).toBeUndefined();
    await fireEvent.click(view.getByRole("button", { name: "Delete this Action" }));
    expect(view.queryByRole("button", { name: /^Unnamed Action/ })).toBeNull();
    await fireEvent.click(view.getByRole("button", { name: "Discard" }));
    expect(view.getByRole("button", { name: /^Unnamed Action/ })).toBeTruthy();
    expect(projectAction).not.toHaveBeenCalled();
  });
});

function mountShell() {
  // A wide viewport keeps the real sidebar visible; jsdom does not perform layout.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const state: DesktopProjectsView = {
    projects, activeProjectId: "alpha",
    actions: [
      { id: "explorer", label: "Open in File Explorer", icon: "codicon-folder-opened" },
      { id: "lazygit", label: "lazygit", icon: "codicon-terminal", section: "actions", scope: "global" },
      ...configured.map((action) => ({
        id: action.id, label: action.label, icon: "codicon-terminal", section: "actions" as const,
        scope: action.projectId ? "project" as const : "global" as const,
        ...(action.projectId ? { projectId: action.projectId } : {}),
      })),
    ],
  };
  const onaction = vi.fn();
  const onsettings = vi.fn();
  const onproject = vi.fn();
  const view = render(DesktopShell, {
    view: state, sessions: [], activeSessionId: null, resume: null,
    children: createRawSnippet(() => ({ render: () => "<div>Client content</div>" })),
    onproject, onadd: vi.fn(), onremove: vi.fn(), onmove: vi.fn(), onaction, onsettings,
    theme: "dark", themeBusy: false, ontheme: vi.fn(), onsidebar: vi.fn(), onsession: vi.fn(), onresume: vi.fn(),
  });
  return { ...view, onaction, onsettings, onproject };
}

describe("Desktop Project menu assembly", () => {
  it("shows one command section with scope icons and an inline settings gear, passing only action identity", async () => {
    const view = mountShell();
    const clientContent = view.getByText("Client content");
    const trigger = view.getByRole("button", { name: "Project Alpha" });
    await fireEvent.click(trigger);
    const menu = within(view.getByRole("menu", { name: "Actions for Alpha" }));
    expect(menu.getByText("Open In")).toBeTruthy();
    expect(menu.getAllByText("Actions")).toHaveLength(1);
    expect(menu.getByRole("menuitem", { name: "lazygit (Global)" }).querySelector(".codicon-globe")).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Global tool (Global)" }).querySelector(".codicon-globe")).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Alpha task (Project)" }).querySelector(".codicon-folder")).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: /Beta task/ })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Remove Project" })).toBeTruthy();
    const gear = menu.getByRole("menuitem", { name: "Configure Actions" });
    expect(gear.parentElement?.textContent?.trim()).toBe("Actions");
    await fireEvent.click(menu.getByRole("menuitem", { name: "Alpha task (Project)" }));
    expect(view.onaction).toHaveBeenCalledExactlyOnceWith("alpha", "alpha-task");
    expect(view.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await fireEvent.click(trigger);
    await fireEvent.click(view.getByRole("menuitem", { name: "Configure Actions" }));
    expect(view.onsettings).toHaveBeenCalledExactlyOnceWith("desktop.actions");
    expect(view.onproject).not.toHaveBeenCalled();
    expect(view.getByText("Client content")).toBe(clientContent);
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("keeps sidebar menus to Open In and Remove for their own target and retains keyboard/outside dismissal", async () => {
    const view = mountShell();
    const sidebarTrigger = view.getByRole("button", { name: "Project actions for Beta" });
    await fireEvent.click(sidebarTrigger);
    const menu = within(view.getByRole("menu", { name: "Actions for Beta" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual(["Open in File Explorer", "Remove Project"]);
    expect(menu.queryByText("Actions")).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Configure Actions" })).toBeNull();
    await fireEvent.click(menu.getByRole("menuitem", { name: "Open in File Explorer" }));
    expect(view.onaction).toHaveBeenCalledExactlyOnceWith("beta", "explorer");
    const mainTrigger = view.getByRole("button", { name: "Project Alpha" });
    await fireEvent.click(mainTrigger);
    expect(document.activeElement).toBe(view.getByRole("menuitem", { name: "Open in File Explorer" }));
    await fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(view.getByRole("menuitem", { name: "Configure Actions" }));
    await fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(view.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(mainTrigger);
    await fireEvent.click(sidebarTrigger);
    await fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).toBeNull();
    expect(view.onproject).not.toHaveBeenCalled();
    expect(view.onsettings).not.toHaveBeenCalled();
  });
});
