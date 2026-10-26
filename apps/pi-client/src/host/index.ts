export type {
  ClientHost,
  HostConfiguration,
  HostConfigurationHooks,
  HostEditorService,
  HostEventEmitter,
  HostInputBoxOptions,
  HostMemento,
  HostOpenFileDialogOptions,
  HostOpenFileMessage,
  HostQuickPickItem,
  HostQuickPickOptions,
  HostQuickPickSeparator,
  HostUri,
  HostWindowService,
  HostWorkspaceFolder,
  HostWorkspaceService,
} from "./clientHost.js";
export { ComposerDraftCache } from "./bridge/ComposerDraftCache.js";
export { WebviewActionDispatcher, type WebviewActionDispatcherDependencies, type DispatchConnection } from "./bridge/WebviewActionDispatcher.js";
export { WebviewConnection, type ConnectionHostInputs } from "./bridge/WebviewConnection.js";
export type { WebviewEndpoint, ConnectionContext } from "./bridge/webviewTypes.js";
export { collectionDelta } from "./bridge/collectionDelta.js";
export { resolveLocalMarkdownImage } from "./bridge/markdown-images/MarkdownImageResolver.js";
export { readConfiguration, readHostProxy } from "./readConfiguration.js";
export { readChatTypography } from "./readChatTypography.js";
export { SessionPersistence } from "./sessions/SessionPersistence.js";
export { parseLaunchArguments } from "./sessions/parseLaunchArguments.js";
export type { PersistedSessionRecord, PersistedSessionRegistry } from "./sessions/sessionTypes.js";
export {
  discoverSessionWorkingDirectories,
  findSessionWorkingDirectory,
  parseGitWorktreeList,
  type GitWorktree,
  type SessionWorkingDirectory,
  type SessionWorkingDirectoryDiscovery,
} from "./sessions/SessionWorkingDirectories.js";
export {
  discoverPiSessions,
  prioritizeSessionRoots,
  readPiSessionMetadata,
  resolveSessionRoots,
  type PiSessionCatalogEntry,
} from "./catalog/SessionCatalog.js";
export { buildSessionQuickPickItems, pickPiSession } from "./catalog/SessionCatalogPicker.js";
export { pickBranchEnd, pickBranchSummary, confirmDraftReplacement } from "./pickers/SessionTreePicker.js";
export { WorkspaceFileSearch } from "./file-search/WorkspaceFileSearch.js";
export {
  parseFdOutput,
  rankFileCandidate,
  type FdEntry,
} from "./file-search/fdResults.js";
export {
  buildFdArguments,
  normalizeGlob,
  resolveQueryScope,
  type ScopedQuery,
  type WorkspaceFileExcludeRule,
  type WorkspaceFileSearchOptions,
} from "./file-search/fdArgs.js";
export {
  parseFdVersion,
  selectFdExecutable,
  type FdExecutable,
} from "./file-search/fdExecutable.js";
export { workspaceFileBoosts, workspaceFileExcludeRules } from "./file-search/mentionSearchContext.js";
export type { RegistryToast, ForkResultSelection, SessionRegistryOptions } from "./SessionRegistry.js";
export { SessionRegistry } from "./SessionRegistry.js";
