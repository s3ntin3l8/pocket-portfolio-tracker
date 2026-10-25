import { describe, expect, it } from "vitest";
import IntlMessageFormat from "intl-messageformat";
import en from "../messages/en.json";
import id from "../messages/id.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

/** Every leaf message with its full key path — the pairs the ICU parser has to accept. */
function messages(obj: Record<string, unknown>, prefix = ""): [key: string, message: string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? messages(v as Record<string, unknown>, `${prefix}${k}.`)
      : [[`${prefix}${k}`, String(v)]],
  );
}

describe("message catalogues", () => {
  const enKeys = new Set(flatten(en));
  const idKeys = new Set(flatten(id));

  it("id.json has every en.json key", () => {
    expect([...enKeys].filter((k) => !idKeys.has(k)).sort()).toEqual([]);
  });

  it("id.json has no orphan keys missing from en.json", () => {
    expect([...idKeys].filter((k) => !enKeys.has(k)).sort()).toEqual([]);
  });

  // A key set that agrees is not enough: a message can be present in both catalogues and
  // still be unparseable. ICU reads "<…>" as a tag, so an unescaped placeholder makes the
  // whole message throw and next-intl falls back to rendering the KEY PATH instead of the
  // text (the "Settings › Connections" instruction used to render as
  // "Settings.mcpPlaceholders"). Every message must parse.
  it("every message in both catalogues parses as an ICU message", () => {
    const failures: string[] = [];
    for (const [locale, catalogue] of [
      ["en", en],
      ["id", id],
    ] as const) {
      for (const [key, message] of messages(catalogue as Record<string, unknown>)) {
        try {
          new IntlMessageFormat(message, locale);
        } catch (err) {
          failures.push(`${locale}:${key} — ${(err as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // The regression this guard exists for: a raw "<placeholder>" inside a message is parsed
  // as an (unclosed) ICU tag. The apostrophe form quotes it, so the angle brackets reach
  // the user as text.
  it("renders an angle-bracket placeholder as text instead of parsing it as a tag", () => {
    expect(
      () =>
        new IntlMessageFormat(
          "Replace <your-pocket-api-url> with the public address of your Pocket API.",
          "en",
        ),
    ).toThrow();
    expect(
      new IntlMessageFormat(
        "Replace '<your-pocket-api-url>' with the public address of your Pocket API.",
        "en",
      ).format(),
    ).toBe("Replace <your-pocket-api-url> with the public address of your Pocket API.");
  });
});
