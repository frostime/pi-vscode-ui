import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { toString(): string }, ...segments: string[]) => ({
      toString: () => [base.toString(), ...segments].join("/"),
    }),
  },
}));

const { createWebviewHtml } = await import("../../src/extension/webview-host/createWebviewHtml.js");

function contentSecurityPolicy(): Record<string, string[]> {
  const webview = { cspSource: "https://*.vscode-cdn.net", asWebviewUri: (uri: unknown) => uri };
  const html = createWebviewHtml(webview as never, { toString: () => "extension" } as never);
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
  return Object.fromEntries(policy.split(";").map((directive) => directive.trim()).filter(Boolean).map((directive): [string, string[]] => {
    const [name = "", ...sources] = directive.split(/\s+/);
    return [name, sources];
  }));
}

describe("Webview Content Security Policy", () => {
  it("denies by default and lets images come only from packaged resources or memory", () => {
    const policy = contentSecurityPolicy();

    expect(policy["default-src"]).toEqual(["'none'"]);
    expect(policy["img-src"]).toEqual(["https://*.vscode-cdn.net", "data:", "blob:"]);
  });

  it("grants no directive a remote scheme, so rendered content has no network channel", () => {
    const policy = contentSecurityPolicy();

    // Mermaid inserts diagram markup into the live document before it can be
    // sanitized; a scheme-wide image source would let that markup send requests.
    for (const [directive, sources] of Object.entries(policy)) {
      for (const source of sources) {
        expect(["https:", "http:", "wss:", "ws:", "*"], `${directive} ${source}`).not.toContain(source);
      }
    }
    expect(Object.keys(policy).sort()).toEqual(["default-src", "font-src", "img-src", "script-src", "style-src"]);
  });
});
