import type { SessionViewModel } from "@frostime/pi-client/shared/model/sessionViewModel";
import { describe, expect, it, vi } from "vitest";

import { DesktopResume } from "../src/main/DesktopResume.js";
import type { DesktopDialog, DesktopResumeView } from "../src/shared/desktopBridge.js";

type SessionProjectionOverrides = Partial<Pick<SessionViewModel, "status" | "historyStatus" | "title" | "error">>;

/** Only the projection fields DesktopResume reads; a complete SessionViewModel is not this test's subject. */
function sessionView(id: string, overrides: SessionProjectionOverrides = {}): SessionViewModel {
  return {
    id,
    title: `Session ${id}`,
    cwd: "/work/demo",
    status: "ready",
    isEphemeral: false,
    isStreaming: false,
    isCompacting: false,
    isForking: false,
    historyStatus: "loading",
    ...overrides,
  } as unknown as SessionViewModel;
}

function pickDialog(id: string): DesktopDialog {
  return { id, kind: "pick", title: "Resume", placeholder: "", matchOnDescription: false, matchOnDetail: false, items: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Lets the in-flight async chain reach its next suspension point. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function currentView(resume: DesktopResume): DesktopResumeView {
  const view = resume.view;
  if (!view) throw new Error("Expected an active Resume view.");
  return view;
}

interface ResumeHarness {
  resume: DesktopResume;
  published: Array<DesktopResumeView | null>;
  sessions: Map<string, SessionViewModel>;
}

function createResume(options: { session?: (id: string) => SessionViewModel | null } = {}): ResumeHarness {
  const published: Array<DesktopResumeView | null> = [];
  const sessions = new Map<string, SessionViewModel>();
  const resume = new DesktopResume({
    project: () => ({ id: "project-1", name: "Demo Project", cwd: "/work/demo" }),
    session: (id) => options.session?.(id) ?? sessions.get(id) ?? null,
    publish: (view) => published.push(view),
  });
  return { resume, published, sessions };
}

describe("DesktopResume", () => {
  it("publishes the finding overlay synchronously, before any discovery work and registry churn", async () => {
    const harness = createResume();
    const discovery = deferred<string | undefined>();
    let viewInsideWork: DesktopResumeView | null = null;
    const pending = harness.resume.run(() => {
      viewInsideWork = harness.resume.view;
      // registry.onDidChange fires while discovery is still running, before the id is known.
      harness.resume.refresh();
      return discovery.promise;
    });

    // First paint must not wait for a Runtime or a Registry round trip.
    expect(harness.published).toHaveLength(1);
    expect(harness.published[0]).toMatchObject({ phase: "finding", visible: true, project: "Demo Project", cwd: "/work/demo" });
    await flush();
    expect(viewInsideWork).toMatchObject({ phase: "finding", visible: true });

    discovery.resolve(undefined);
    await expect(pending).resolves.toBeUndefined();
    expect(harness.resume.view).toBeNull();
  });

  it("gates history on the returned session id while another session is already loaded", async () => {
    const saved = sessionView("saved-1", { status: "ready", historyStatus: "queued" });
    const foreground = sessionView("foreground-1", { historyStatus: "loaded" });
    const harness = createResume({ session: (id) => (id === saved.id ? saved : foreground) });

    await expect(harness.resume.run(() => Promise.resolve("saved-1"))).resolves.toBe("saved-1");
    expect(harness.resume.view).toMatchObject({ phase: "loading", sessionId: "saved-1", sessionTitle: "Session saved-1" });

    saved.historyStatus = "loading";
    harness.resume.refresh();
    expect(harness.resume.view).toMatchObject({ phase: "loading", sessionId: "saved-1" });

    saved.historyStatus = "loaded";
    harness.resume.refresh();
    expect(harness.resume.view).toBeNull();
  });

  it("keeps loading for pending history and reports every terminal failure of the resumed session", async () => {
    const cases: Array<{
      label: string;
      session: SessionViewModel | null;
      expected: { phase: DesktopResumeView["phase"]; error?: string } | null;
    }> = [
      {
        label: "a ready runtime with pending history shows history loading",
        session: sessionView("saved-1", { status: "ready", historyStatus: "loading" }),
        expected: { phase: "loading" },
      },
      {
        label: "loaded history closes the overlay",
        session: sessionView("saved-1", { historyStatus: "loaded" }),
        expected: null,
      },
      {
        label: "deferred history stays in the shared client's own UI",
        session: sessionView("saved-1", { historyStatus: "deferred" }),
        expected: null,
      },
      {
        label: "a missing session projection reports failure",
        session: null,
        expected: { phase: "failed", error: "The session stopped or its conversation history could not be loaded." },
      },
      {
        label: "a stopped session reports failure",
        session: sessionView("saved-1", { status: "stopped" }),
        expected: { phase: "failed", error: "The session stopped or its conversation history could not be loaded." },
      },
      {
        label: "failed history reports failure",
        session: sessionView("saved-1", { historyStatus: "failed" }),
        expected: { phase: "failed", error: "The session stopped or its conversation history could not be loaded." },
      },
      {
        label: "the session's own error message is surfaced",
        session: sessionView("saved-1", { status: "failed", error: "Pi exited before loading history." }),
        expected: { phase: "failed", error: "Pi exited before loading history." },
      },
    ];

    for (const { label, session, expected } of cases) {
      const harness = createResume();
      if (session) harness.sessions.set(session.id, session);
      await harness.resume.run(() => Promise.resolve("saved-1"));
      if (expected === null) expect(harness.resume.view, label).toBeNull();
      else expect(harness.resume.view, label).toMatchObject(expected);
    }
  });

  it("keeps opening while the resumed runtime is still starting, even when its history is already loaded", async () => {
    const resumed = sessionView("saved-1", { status: "queued", historyStatus: "loaded" });
    const harness = createResume();
    harness.sessions.set(resumed.id, resumed);

    await harness.resume.run(() => Promise.resolve("saved-1"));
    expect(harness.resume.view).toMatchObject({ phase: "opening", sessionId: "saved-1" });

    resumed.status = "starting";
    harness.resume.refresh();
    expect(harness.resume.view).toMatchObject({ phase: "opening", sessionId: "saved-1" });

    resumed.status = "ready";
    harness.resume.refresh();
    expect(harness.resume.view).toBeNull();
  });

  it("preserves the original resume error unchanged, including non-Error rejections", async () => {
    const harness = createResume();
    const failure = new Error("No saved sessions were found.");
    const failed = harness.resume.run(() => Promise.reject(failure));
    await expect(failed).rejects.toBe(failure);
    expect(harness.resume.view).toMatchObject({ phase: "failed", error: "No saved sessions were found.", visible: true });

    // A non-Error rejection must still reach the caller unchanged and fall back to a readable message.
    const thrown: unknown = "catalog unavailable";
    const nonError = createResume();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error rejection is the branch under test.
    const rejected = nonError.resume.run(() => Promise.reject(thrown));
    await expect(rejected).rejects.toBe(thrown);
    expect(nonError.resume.view).toMatchObject({ phase: "failed", error: "The saved session could not be opened." });
  });

  it("shows its own picker while leaving a concurrent unrelated selection untouched", async () => {
    const harness = createResume();
    harness.sessions.set("saved-1", sessionView("saved-1"));
    const choice = deferred<string | undefined>();
    let pickerIdVisibleToRenderer: string | undefined;
    const pending = harness.resume.run(async () => {
      return harness.resume.choose("session", async () => {
        harness.resume.dialogShown(pickDialog("resume-picker"));
        pickerIdVisibleToRenderer = harness.resume.view?.pickerId;
        return choice.promise;
      });
    });

    await flush();
    expect(harness.resume.view).toMatchObject({ phase: "choosing", selection: "session", pickerId: "resume-picker" });
    expect(pickerIdVisibleToRenderer).toBe("resume-picker");

    // Another Host selection runs outside the Resume scope, so it must not adopt the picker.
    await expect(harness.resume.choose("file", () => Promise.resolve("foreign-selection"))).resolves.toBe("foreign-selection");
    harness.resume.dialogShown(pickDialog("foreign-picker"));
    expect(harness.resume.view).toMatchObject({ phase: "choosing", selection: "session", pickerId: "resume-picker" });

    choice.resolve("saved-1");
    await expect(pending).resolves.toBe("saved-1");
    expect(harness.resume.view).toMatchObject({ phase: "loading", sessionId: "saved-1" });
    expect(harness.resume.view?.selection).toBeUndefined();
    expect(harness.resume.view?.pickerId).toBeUndefined();
  });

  it("clears the overlay when the picker is cancelled instead of claiming an opening", async () => {
    const harness = createResume();
    let viewAfterCancel: DesktopResumeView | null = null;
    const pending = harness.resume.run(async () => {
      const selected = await harness.resume.choose("session", () => Promise.resolve(undefined));
      viewAfterCancel = harness.resume.view;
      return selected;
    });

    await expect(pending).resolves.toBeUndefined();
    expect(viewAfterCancel).toMatchObject({ phase: "choosing" });
    expect(harness.resume.view).toBeNull();
  });

  it("dismisses only the matching failed flow and never a busy one", async () => {
    const busy = createResume();
    busy.sessions.set("saved-1", sessionView("saved-1"));
    await busy.resume.run(() => Promise.resolve("saved-1"));
    const busyId = currentView(busy.resume).id;
    busy.resume.dismiss(busyId);
    expect(busy.resume.view).toMatchObject({ id: busyId, phase: "loading" });

    const failed = createResume();
    await expect(failed.resume.run(() => Promise.reject(new Error("No saved sessions were found.")))).rejects.toThrow();
    const failedId = currentView(failed.resume).id;
    failed.resume.dismiss("stale-flow");
    expect(failed.resume.view).toMatchObject({ id: failedId, phase: "failed" });
    failed.resume.dismiss(failedId);
    expect(failed.resume.view).toBeNull();
  });

  it("re-shows the active flow for a duplicate resume and starts new work only after a failure", async () => {
    const harness = createResume();
    harness.sessions.set("saved-1", sessionView("saved-1"));
    const discovery = deferred<string | undefined>();
    const work = vi.fn(() => discovery.promise);
    const first = harness.resume.run(work);
    await flush();
    const firstView = currentView(harness.resume);

    harness.resume.hide();
    expect(harness.resume.view).toMatchObject({ id: firstView.id, visible: false, phase: "finding" });
    const duplicate = harness.resume.run(work);
    expect(harness.resume.view).toMatchObject({ id: firstView.id, visible: true, phase: "finding" });

    discovery.resolve("saved-1");
    await expect(first).resolves.toBe("saved-1");
    await expect(duplicate).resolves.toBe("saved-1");
    await expect(harness.resume.run(work)).resolves.toBe("saved-1");
    expect(work).toHaveBeenCalledTimes(1);

    const retryHarness = createResume();
    await expect(retryHarness.resume.run(() => Promise.reject(new Error("Pi is unavailable.")))).rejects.toThrow();
    const failedView = currentView(retryHarness.resume);
    const retry = deferred<string | undefined>();
    const retried = retryHarness.resume.run(() => retry.promise);
    const retriedView = currentView(retryHarness.resume);
    expect(retriedView.id).not.toBe(failedView.id);
    expect(retriedView).toMatchObject({ phase: "finding", visible: true });
    retry.resolve(undefined);
    await expect(retried).resolves.toBeUndefined();
  });

  it("ignores late completion after dispose and refuses new work", async () => {
    const harness = createResume();
    harness.sessions.set("saved-1", sessionView("saved-1"));
    const discovery = deferred<string | undefined>();
    const pending = harness.resume.run(() => discovery.promise);
    await flush();

    harness.resume.dispose();
    const publishedAtDispose = harness.published.length;
    expect(harness.resume.view).toBeNull();
    expect(harness.published.at(-1)).toBeNull();

    discovery.resolve("saved-1");
    await expect(pending).resolves.toBe("saved-1");
    expect(harness.published).toHaveLength(publishedAtDispose);
    expect(harness.resume.view).toBeNull();
    await expect(harness.resume.run(() => Promise.resolve("saved-1"))).rejects.toThrow("The Desktop window is closed.");
  });
});
