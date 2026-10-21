import { describe, expect, it } from "vitest";

import type { ClientHost } from "../../src/host/clientHost.js";
import { readConfiguration } from "../../src/host/readConfiguration.js";

/** Configuration parsing is single-source: hosts only shape `getConfiguration(section, scope)`. */
describe("FrostPi configuration reading", () => {
  function hostWithConfiguration(values: Record<string, unknown>): ClientHost {
    return {
      configuration: {
        getConfiguration: () => ({
          get: <T>(section: string, fallback: T) => (section in values ? (values[section] as T) : fallback),
          update: () => {
            throw new Error("not used here");
          },
        }),
      },
    } as never;
  }

  it("applies every default without host-side duplicates", () => {
    const configuration = readConfiguration(hostWithConfiguration({}));
    expect(configuration).toEqual({
      runtimeCompatibility: "pi",
      piArguments: [],
      startSessionOnOpen: true,
      streamingBehavior: "followUp",
      collapseTurnTrace: true,
      questionToolEnabled: false,
      maxImageBytes: 10 * 1024 * 1024,
      diagnosticsLevel: "info",
      experimentalNotificationsEnabled: false,
      proxy: { mode: "inherit", noProxy: "localhost,127.0.0.1,::1" },
      fileMentionRespectSearchExclude: true,
      fileMentionRespectIgnoreFiles: true,
      fileMentionFollowSymlinks: true,
    });
  });

  it("passes scope strings through and honors host values", () => {
    const scopes: Array<string | undefined> = [];
    const host = {
      configuration: {
        getConfiguration: (section: string, scope?: string) => {
          scopes.push(scope);
          return {
            get: <T>(section: string, fallback: T) => (section === "pi.executable" ? ("/pi/cli.js" as T) : fallback),
            update: () => Promise.resolve(),
          };
        },
      },
    } as never;
    const configuration = readConfiguration(host, "C:/projects/alpha");
    expect(configuration.piExecutable).toBe("/pi/cli.js");
    expect(scopes).toEqual(["C:/projects/alpha"]);
  });

  it("ignores blank proxy endpoint but keeps later http fallbacks", () => {
    const configuration = readConfiguration(hostWithConfiguration({
      "network.proxy.endpoint": "   ",
      "network.proxy.http": "http://10.0.0.2:8080",
      "network.proxy.noProxy": "localhost,.internal",
    }));
    expect(configuration.proxy).toEqual({
      mode: "inherit",
      endpoint: "http://10.0.0.2:8080",
      noProxy: "localhost,.internal",
    });
  });
});
