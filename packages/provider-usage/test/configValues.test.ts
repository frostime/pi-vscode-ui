import { describe, expect, it } from "vitest";

import { parseConfigValue, referenceEnvVarNames, resolveConfigValue } from "../src/configValues.js";

const fakeEnvironment = (name: string): string | undefined => (name === "FAKE_TEST_KEY" ? "value" : undefined);

describe("configuration value references", () => {
  it("resolves literal values unchanged", () => {
    expect(resolveConfigValue("literal-key-value", fakeEnvironment)).toBe("literal-key-value");
  });

  it("resolves $NAME and ${NAME} references", () => {
    expect(resolveConfigValue("$FAKE_TEST_KEY", fakeEnvironment)).toBe("value");
    expect(resolveConfigValue("${FAKE_TEST_KEY}", fakeEnvironment)).toBe("value");
    expect(resolveConfigValue("pre-$FAKE_TEST_KEY-post", fakeEnvironment)).toBe("pre-value-post");
  });

  it("returns undefined when a referenced variable is missing", () => {
    expect(resolveConfigValue("$FAKE_MISSING_KEY", fakeEnvironment)).toBeUndefined();
    expect(resolveConfigValue("pre-$FAKE_MISSING_KEY", fakeEnvironment)).toBeUndefined();
  });

  it("keeps `$$` and `$!` as escape literals", () => {
    expect(resolveConfigValue("a$$b", fakeEnvironment)).toBe("a$b");
    expect(resolveConfigValue("a$!b", fakeEnvironment)).toBe("a!b");
  });

  it("keeps an unterminated `${` literal and invalid `${NAME}` text literal", () => {
    expect(resolveConfigValue("a${", fakeEnvironment)).toBe("a${");
    expect(resolveConfigValue("a${not a name}", fakeEnvironment)).toBe("a${not a name}");
  });

  it("keeps a bare `$` literal", () => {
    expect(resolveConfigValue("a$", fakeEnvironment)).toBe("a$");
  });

  it("classifies leading `!` values as unsupported command references", () => {
    expect(parseConfigValue("!some command $FAKE_TEST_KEY").kind).toBe("command");
    expect(resolveConfigValue("!some command $FAKE_TEST_KEY", fakeEnvironment)).toBeUndefined();
  });

  it("lists referenced variable names once", () => {
    const names = referenceEnvVarNames(parseConfigValue("$FAKE_TEST_KEY-${FAKE_TEST_KEY}-$FAKE_MISSING_KEY"));
    expect(names).toEqual(["FAKE_TEST_KEY", "FAKE_MISSING_KEY"]);
  });

  it("reports configured-ness for complete/missing references", () => {
    const reference = parseConfigValue("$FAKE_TEST_KEY-$FAKE_MISSING_KEY");
    const lookup = (name: string) => (name === "FAKE_TEST_KEY" ? "value" : undefined);
    expect(reference.kind === "template" && reference.parts.length).toBe(3);
    expect(resolveConfigValue("$FAKE_TEST_KEY", lookup)).toBe("value");
  });
});
