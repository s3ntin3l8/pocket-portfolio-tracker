import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import id from "../messages/id.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? flatten(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
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
});
