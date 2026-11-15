import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(policy.split(";").map((directive) => directive.trim()).filter(Boolean).map((directive): [string, string[]] => {
    const [name = "", ...sources] = directive.split(/\s+/);
    return [name, sources];
  }));
}

const policies = {
  "renderer document": /http-equiv="Content-Security-Policy" content="([^"]+)"/
    .exec(readFileSync(resolve(root, "src/renderer/index.html"), "utf8"))?.[1] ?? "",
  "Tauri window": (JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8")) as {
    app: { security: { csp: string } };
  }).app.security.csp,
};

describe.each(Object.entries(policies))("Desktop %s Content Security Policy", (_name, policy) => {
  it("loads images only from the application or memory", () => {
    expect(directives(policy)["img-src"]).toEqual(["'self'", "data:", "blob:"]);
  });

  it("grants no directive a remote scheme, so rendered content has no network channel", () => {
    // The shared UI inserts Mermaid markup into the live document before it can be
    // sanitized; consented remote Markdown images arrive as Host-fetched bytes instead.
    for (const [directive, sources] of Object.entries(directives(policy))) {
      for (const source of sources) {
        expect(["https:", "http:", "wss:", "ws:", "*"], `${directive} ${source}`).not.toContain(source);
      }
    }
  });
});
