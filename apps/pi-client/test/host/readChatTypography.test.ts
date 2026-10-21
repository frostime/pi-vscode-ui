import { describe, expect, it } from "vitest";

import { readChatTypography } from "../../src/host/readChatTypography.js";

describe("readChatTypography", () => {
  it("uses VS Code fonts when Chat settings are default", () => {
    const typography = readChatTypography(settings({
      fontFamily: "default",
      fontSize: 13,
      "editor.fontFamily": "default",
      "editor.fontSize": 14,
    }));

    expect(typography).toEqual({
      message: { fontSize: 13 },
      composer: { fontSize: 14 },
    });
  });

  it("keeps Chat message and Composer typography independent", () => {
    const typography = readChatTypography(settings({
      fontFamily: "Inter",
      fontSize: 16,
      "editor.fontFamily": "JetBrains Mono",
      "editor.fontSize": 15,
    }));

    expect(typography).toEqual({
      message: { fontFamily: "Inter", fontSize: 16 },
      composer: { fontFamily: "JetBrains Mono", fontSize: 15 },
    });
  });

  it("falls back safely when a supported setting is unavailable or invalid", () => {
    const typography = readChatTypography(settings({
      fontFamily: "",
      fontSize: 0,
      "editor.fontFamily": "default",
      "editor.fontSize": Number.NaN,
    }));

    expect(typography).toEqual({
      message: { fontSize: 13 },
      composer: { fontSize: 14 },
    });
  });
});

function settings(values: Record<string, string | number>) {
  return {
    get<T>(section: string, defaultValue: T): T {
      return (values[section] ?? defaultValue) as T;
    },
  };
}
