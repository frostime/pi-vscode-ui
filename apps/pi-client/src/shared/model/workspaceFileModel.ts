export interface WorkspaceFileCandidateView {
  path: string;
  name: string;
  directory: string;
  score: number;
  isDirectory: boolean;
}

/** Built-in @ completion row (path/line reference only; no file body). */
export interface EditorMentionSpecialView {
  id: "selection" | "current-file";
  label: string;
  detail: string;
  insertText: string;
}
