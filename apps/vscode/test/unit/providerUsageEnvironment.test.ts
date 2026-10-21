import { describe, expect, it } from "vitest";
import { buildProviderUsageEnvironment, DEFAULT_NO_PROXY } from "@frostime/pi-client/core/network/buildPiProcessEnvironment";

const proxyKeys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
const base: NodeJS.ProcessEnv = Object.fromEntries<string>([
  ...proxyKeys.map((key): [string, string] => [key, "synthetic-inherited-value"]),
  ["SYNTHETIC_PROVIDER_KEY", "synthetic-provider-credential"],
]);

describe("provider usage proxy environment", () => {
  it("inherits only in inherit mode and removes every proxy variable in direct mode without changing the base", () => {
    const inherited = buildProviderUsageEnvironment(base, { mode: "inherit" });
    const direct = buildProviderUsageEnvironment(base, { mode: "direct" });
    expect(proxyKeys.every((key) => inherited[key] === base[key])).toBe(true);
    expect(proxyKeys.every((key) => direct[key] === undefined)).toBe(true);
    expect(direct.SYNTHETIC_PROVIDER_KEY === base.SYNTHETIC_PROVIDER_KEY).toBe(true);
    expect(proxyKeys.every((key) => base[key] === "synthetic-inherited-value")).toBe(true);
    expect(inherited === base).toBe(false);
  });

  it("replaces inherited proxy settings with the custom authenticated endpoint and bypass list", () => {
    const credentials = { username: "synthetic user", password: "synthetic@password" };
    const environment = buildProviderUsageEnvironment(base,
      { mode: "custom", endpoint: "127.0.0.1:7890", noProxy: "example.test" }, credentials);
    const url = new URL(environment.HTTPS_PROXY!);
    expect(url.hostname === "127.0.0.1" && url.port === "7890"
      && decodeURIComponent(url.username) === credentials.username
      && decodeURIComponent(url.password) === credentials.password).toBe(true);
    expect(environment.http_proxy === environment.HTTPS_PROXY && environment.https_proxy === environment.HTTP_PROXY).toBe(true);
    expect(environment.ALL_PROXY === undefined && environment.all_proxy === undefined).toBe(true);
    expect(environment.NO_PROXY === "example.test" && environment.no_proxy === "example.test").toBe(true);
    expect(environment.SYNTHETIC_PROVIDER_KEY === base.SYNTHETIC_PROVIDER_KEY).toBe(true);
  });

  it("uses the VS Code endpoint with the default bypass list, not inherited proxy settings", () => {
    const environment = buildProviderUsageEnvironment(base,
      { mode: "vscode", endpoint: "127.0.0.1:7890" }, undefined, "http://127.0.0.1:9000");
    expect(environment.HTTP_PROXY === "http://127.0.0.1:9000" && environment.HTTPS_PROXY === environment.HTTP_PROXY).toBe(true);
    expect(environment.NO_PROXY === DEFAULT_NO_PROXY && environment.no_proxy === DEFAULT_NO_PROXY).toBe(true);
    expect(environment.ALL_PROXY === undefined && environment.all_proxy === undefined).toBe(true);
  });

  it("keeps SOCKS explicit so the package rejects it rather than using an inherited HTTP proxy", () => {
    const environment = buildProviderUsageEnvironment(base, { mode: "custom", endpoint: "socks5://127.0.0.1:1080" });
    expect(environment.ALL_PROXY === "socks5://127.0.0.1:1080").toBe(true);
    expect(environment.HTTP_PROXY === undefined && environment.HTTPS_PROXY === undefined
      && environment.http_proxy === undefined && environment.https_proxy === undefined).toBe(true);
  });

  it("rejects empty explicit settings rather than silently connecting directly", () => {
    expect(() => buildProviderUsageEnvironment(base, { mode: "custom" })).toThrow("not configured");
    expect(() => buildProviderUsageEnvironment(base, { mode: "vscode" }, undefined, " ")).toThrow("not configured");
  });
});
