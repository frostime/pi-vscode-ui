import type { HostMemento } from "../clientHost.js";

import type { PersistedSessionRecord, PersistedSessionRegistry } from "./sessionTypes.js";

const STORAGE_KEY = "frostpi.sessions.v1";

export class SessionPersistence {
  readonly #state: HostMemento;

  constructor(state: HostMemento) {
    this.#state = state;
  }

  load(): PersistedSessionRegistry {
    const stored = this.#state.get<PersistedSessionRegistry>(STORAGE_KEY);
    if (!stored || stored.version !== 1 || !Array.isArray(stored.sessions)) {
      return { version: 1, activeSessionId: null, sessions: [] };
    }
    return {
      version: 1,
      activeSessionId: typeof stored.activeSessionId === "string" ? stored.activeSessionId : null,
      sessions: stored.sessions.filter(isRecord),
    };
  }

  save(activeSessionId: string | null, sessions: PersistedSessionRecord[]): PromiseLike<void> {
    return this.#state.update(STORAGE_KEY, { version: 1, activeSessionId, sessions } satisfies PersistedSessionRegistry);
  }
}

function isRecord(value: unknown): value is PersistedSessionRecord {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { cwd?: unknown }).cwd === "string" &&
    typeof (value as { updatedAt?: unknown }).updatedAt === "number"
  );
}
