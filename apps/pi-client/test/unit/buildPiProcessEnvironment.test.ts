import { describe, expect, it } from "vitest";

import {
  buildPiProcessEnvironment,
  DEFAULT_NO_PROXY,
  normalizeProxyEndpoint,
  proxyFingerprint,
} from "../../src/core/network/buildPiProcessEnvironment.js";

describe("Pi process proxy environment", () => {
  it("clears both uppercase and lowercase proxy variables in direct mode", () => {
    const result = buildPiProcessEnvironment({ mode: "direct" });
    expect(result.env).toMatchObject({
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
    });
  });

  it("injects credentials without storing them in the proxy fingerprint", () => {
    const result = buildPiProcessEnvironment(
      { mode: "custom", endpoint: "http://proxy.example:8080" },
      { username: "alice", password: "secret" },
    );
    expect(result.env.HTTPS_PROXY).toContain("alice:secret@");
    expect(proxyFingerprint({ mode: "custom", endpoint: "http://proxy.example:8080" })).not.toContain("secret");
  });

  it("uses the VS Code proxy only in vscode mode", () => {
    expect(buildPiProcessEnvironment({ mode: "vscode" }, undefined, "http://localhost:9000").env.HTTP_PROXY).toBe("http://localhost:9000");
    expect(buildPiProcessEnvironment({ mode: "inherit" }, undefined, "http://localhost:9000").env.HTTP_PROXY).toBeUndefined();
  });

  it("normalizes bare host:port proxy endpoints to http URLs", () => {
    expect(normalizeProxyEndpoint("127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(normalizeProxyEndpoint("http://127.0.0.1:7890")).toBe("http://127.0.0.1:7890");
    expect(normalizeProxyEndpoint("socks5://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
    const result = buildPiProcessEnvironment({ mode: "custom", endpoint: "127.0.0.1:7890" });
    expect(result.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(result.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
  });

  it("defaults NO_PROXY to local loopback hosts when unset", () => {
    const custom = buildPiProcessEnvironment({ mode: "custom", endpoint: "127.0.0.1:7890" });
    expect(custom.env.NO_PROXY).toBe(DEFAULT_NO_PROXY);
    const vscode = buildPiProcessEnvironment({ mode: "vscode" }, undefined, "http://proxy:1");
    expect(vscode.env.NO_PROXY).toBe(DEFAULT_NO_PROXY);
    const explicit = buildPiProcessEnvironment({ mode: "custom", endpoint: "127.0.0.1:7890", noProxy: "example.com" });
    expect(explicit.env.NO_PROXY).toBe("example.com");
  });

  it("maps one HTTP endpoint to both HTTP_PROXY and HTTPS_PROXY", () => {
    const result = buildPiProcessEnvironment({ mode: "custom", endpoint: "127.0.0.1:7890" });
    expect(result.env.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(result.env.HTTPS_PROXY).toBe("http://127.0.0.1:7890");
    expect(result.env.ALL_PROXY).toBeUndefined();
  });

  it("maps socks endpoints to ALL_PROXY only", () => {
    const result = buildPiProcessEnvironment({ mode: "custom", endpoint: "socks5://127.0.0.1:1080" });
    expect(result.env.ALL_PROXY).toBe("socks5://127.0.0.1:1080");
    expect(result.env.all_proxy).toBe("socks5://127.0.0.1:1080");
    expect(result.env.HTTP_PROXY).toBeUndefined();
    expect(result.env.HTTPS_PROXY).toBeUndefined();
  });

  it("leaves inherit mode as an empty override map so host env is preserved", () => {
    expect(buildPiProcessEnvironment({ mode: "inherit" }).env).toEqual({});
  });
});
