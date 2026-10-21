import type * as vscode from "vscode";

import type { ProxyCredentials } from "@frostime/pi-client/core/network/proxyCredentials";

const SECRET_KEY = "frostpi.network.proxy.credentials.v1";

export class ProxySecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<ProxyCredentials | undefined> {
    const value = await this.secrets.get(SECRET_KEY);
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as Partial<ProxyCredentials>;
      return typeof parsed.username === "string" && typeof parsed.password === "string"
        ? { username: parsed.username, password: parsed.password }
        : undefined;
    } catch {
      return undefined;
    }
  }

  set(credentials: ProxyCredentials): Thenable<void> {
    return this.secrets.store(SECRET_KEY, JSON.stringify(credentials));
  }

  clear(): Thenable<void> {
    return this.secrets.delete(SECRET_KEY);
  }
}
