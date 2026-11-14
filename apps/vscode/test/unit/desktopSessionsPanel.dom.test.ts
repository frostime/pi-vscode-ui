import { cleanup, fireEvent, render, within } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DesktopShell from "../../../desktop/src/renderer/DesktopShell.svelte";
import type { DesktopProject, DesktopProjectsView, DesktopProjectActivity } from "../../../desktop/src/shared/desktopBridge.js";
import type { SessionSummaryView } from "../../../pi-client/src/shared/model/sessionViewModel.js";

const projects: DesktopProject[] = [
  { id: "alpha", name: "Alpha", cwd: "C:\\Projects\\Alpha" },
  { id: "beta", name: "Beta", cwd: "C:\\Projects\\Beta" },
];

function summary(id: string, title: string, overrides: Partial<SessionSummaryView> = {}): SessionSummaryView {
  return {
    id, title, cwd: "C:\\Projects\\Alpha", status: "ready", isActive: false, isEphemeral: false,
    historyStatus: "loaded", requiresUserInput: false, ...overrides,
  };
}

const sessions: SessionSummaryView[] = [
  summary("a-run", "Alpha running", { status: "running", isActive: true }),
  summary("a-wait", "Alpha waiting", { requiresUserInput: true }),
  summary("a-idle", "Alpha idle"),
  summary("b-fail", "Beta failed", { cwd: "C:\\Projects\\Beta", status: "failed" }),
  summary("b-run", "Beta running", { cwd: "C:\\Projects\\Beta", status: "running" }),
  summary("stopped", "Alpha stopped", { status: "stopped" }),
  // A Session the navigation metadata cannot place has no row.
  summary("orphan", "Orphan running", { status: "running" }),
];

const activity: Record<string, DesktopProjectActivity> = {
  alpha: { total: 4, running: 1, waitingSessionIds: ["a-wait"] },
  beta: { total: 2, running: 1, waitingSessionIds: [] },
};

const browserMethods: Array<() => void> = [];
beforeAll(() => {
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
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => {
  browserMethods.forEach((restore) => restore());
  vi.unstubAllGlobals();
});

function mount(allSessions: SessionSummaryView[] = sessions, activeSessionId: string | null = "a-run") {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 800));
  const view: DesktopProjectsView = {
    projects, activeProjectId: "alpha",
    navigation: {
      sidebar: { hidden: false, width: 252 },
      sessionProjects: {
        "a-run": "alpha", "a-wait": "alpha", "a-idle": "alpha", stopped: "alpha",
        "b-fail": "beta", "b-run": "beta",
      },
      activity,
    },
  };
  const onsession = vi.fn();
  const onproject = vi.fn();
  const rendered = render(DesktopShell, {
    view, sessions: allSessions.filter((session) => session.cwd === "C:\\Projects\\Alpha"),
    allSessions, activeSessionId, resume: null,
    children: createRawSnippet(() => ({ render: () => "<div>Client content</div>" })),
    onproject, onadd: vi.fn(), onremove: vi.fn(), onmove: vi.fn(), onaction: vi.fn(), onsettings: vi.fn(),
    theme: "dark", themeBusy: false, ontheme: vi.fn(), onsidebar: vi.fn(), onsession, onresume: vi.fn(),
  });
  const sidebar = () => rendered.container.querySelector<HTMLElement>("#desktop-projects")!;
  const sessionTitles = () => [...sidebar().querySelectorAll(".session-title")].map((el) => el.textContent);
  const projectRows = () => [...sidebar().querySelectorAll(".project-row")];
  return { ...rendered, sidebar, sessionTitles, projectRows, onsession, onproject };
}

describe("Desktop Sessions section", () => {
  it("lists every loaded Session, ordered wait then fail then running then the calm tail", () => {
    const view = mount();
    // A Session must not vanish when its turn settles, so idle and stopped rows stay listed.
    expect(view.sessionTitles()).toEqual([
      "Alpha waiting", "Beta failed", "Alpha running", "Beta running", "Alpha idle", "Alpha stopped",
    ]);
    expect(view.queryByText("Orphan running")).toBeNull();
    const section = within(view.sidebar().querySelector<HTMLElement>(".sect.sessions")!);
    expect(section.getByText("Sessions")).toBeTruthy();
    // The header counts only the Sessions that need you.
    expect(section.getByText("2")).toBeTruthy();
    // An urgent row names its state; a calm row carries only its Project.
    expect(section.getByText("Beta \u00b7 failed")).toBeTruthy();
    expect(section.getAllByText("Alpha")).toHaveLength(2);
  });

  it("opens the clicked Session, including one that belongs to another Project", async () => {
    const view = mount();
    await fireEvent.click(view.getByText("Beta failed"));
    expect(view.onsession).toHaveBeenCalledExactlyOnceWith("b-fail");
    expect(view.onproject).not.toHaveBeenCalled();
  });

  it("tags a Project row with the states needing you and jumps to that state's first Session", async () => {
    const view = mount();
    const [alpha, beta] = view.projectRows();
    const alphaTags = [...alpha!.querySelectorAll(".state-tag")];
    expect(alphaTags).toHaveLength(1);
    expect(alphaTags[0]!.classList.contains("wait")).toBe(true);
    expect(alphaTags[0]!.textContent?.trim()).toBe("1");
    const betaTags = [...beta!.querySelectorAll(".state-tag")];
    expect(betaTags).toHaveLength(1);
    expect(betaTags[0]!.classList.contains("fail")).toBe(true);
    await fireEvent.click(alpha!.querySelector(".state-tag.wait")!);
    expect(view.onsession).toHaveBeenCalledExactlyOnceWith("a-wait");
  });

  it("folds each section independently while the other keeps its content", async () => {
    const view = mount();
    await fireEvent.click(view.getByRole("button", { name: "Toggle Projects" }));
    expect(view.projectRows()).toHaveLength(0);
    expect(view.sessionTitles()).toHaveLength(6);
    await fireEvent.click(view.getByRole("button", { name: "Toggle Sessions" }));
    expect(view.sessionTitles()).toHaveLength(0);
    expect(within(view.sidebar()).getByText("Sessions")).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "Toggle Sessions" }));
    expect(view.sessionTitles()).toHaveLength(6);
  });

  it("renders no Sessions section when none is loaded, and leaves calm rows out of Project tags", () => {
    const view = mount([]);
    expect(view.sidebar().querySelector(".sect.sessions")).toBeNull();
    expect(view.sidebar().querySelector(".splitter")).toBeNull();
    expect(view.projectRows()).toHaveLength(2);
    expect(view.projectRows()[0]!.querySelectorAll(".state-tag")).toHaveLength(0);
  });
});
