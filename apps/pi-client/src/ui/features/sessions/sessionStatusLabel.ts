import type { SessionViewModel } from "$shared/model/sessionViewModel";

/** One short phrase for what the displayed Session is doing, most urgent state first. */
export function sessionStatusLabel(session: SessionViewModel): string {
  if (session.pendingExtensionUi.length > 0) return "action required";
  if (session.isForking) return "forking session";
  if (session.isNavigatingTree) return session.isSummarizingTree ? "summarizing branch" : "switching branch";
  if (session.isCompacting) return "compacting context";
  if (session.status === "queued") return "waiting to start";
  if (session.historyStatus === "queued") return "waiting for history";
  if (session.historyStatus === "loading") return "loading history";
  if (session.status === "running") {
    if (session.historyStatus === "deferred") return "running · history not loaded";
    if (session.historyStatus === "failed") return "running · history load failed";
    return "running";
  }
  if (session.historyStatus === "deferred") return "history not loaded";
  if (session.historyStatus === "failed") return "history load failed";
  if (session.status === "ready") return "ready";
  return session.status;
}
