export interface PersistedSessionRecord {
  id: string;
  title: string;
  cwd: string;
  sessionFile?: string;
  ephemeral?: boolean;
  updatedAt: number;
}

export interface PersistedSessionRegistry {
  version: 1;
  activeSessionId: string | null;
  sessions: PersistedSessionRecord[];
}
