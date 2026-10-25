import { describe, expect, it } from "vitest";
import type { ImportRecord } from "@portfolio/api-client";
import { sourceMeta } from "../src/components/import-history/utils";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";

/**
 * R4-F7 regression guard for the import-history source label: the label is looked up with a
 * DYNAMIC key (`sources.<sourceType>`), which next-intl can't verify at build time. A source
 * type that isn't in the catalogue must render a real, translatable fallback — never the key
 * path (and never throw).
 */

/** A `Transactions`-namespace translator over the real catalogue. */
function translator(catalogue: Record<string, unknown>) {
  const resolve = (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        catalogue,
      );
  const t = (key: string) => {
    const message = resolve(key);
    if (typeof message !== "string") throw new Error(`missing message: ${key}`);
    return message;
  };
  return Object.assign(t, { has: (key: string) => typeof resolve(key) === "string" });
}

function record(parser: string, originalFilename: string | null = null): ImportRecord {
  return {
    id: "imp-1",
    portfolioId: null,
    parser,
    status: "draft",
    confidence: null,
    count: 1,
    batchId: null,
    createdAt: "2026-06-10T10:00:00.000Z",
    document: null,
    originalFilename,
  };
}

const en = messages.Transactions as unknown as Record<string, unknown>;
const id = idMessages.Transactions as unknown as Record<string, unknown>;

describe("sourceMeta resolves the source label through the catalogue", () => {
  it("uses the catalogue label for a source type that IS in the catalogue", () => {
    const { sourceLabel } = sourceMeta(record("pytr"), translator(en));

    expect(sourceLabel).toBe((en.sources as Record<string, string>).pytr);
  });

  it("falls back to the catalogue fallback for a source type that is NOT in the catalogue", () => {
    // A catalogue that lost the `pytr` entry — the dynamic key would otherwise render the
    // key path (or throw).
    const withoutPytr = { ...en, sources: { ...(en.sources as Record<string, string>) } };
    delete (withoutPytr.sources as Record<string, string>).pytr;

    const { sourceLabel, label } = sourceMeta(record("pytr"), translator(withoutPytr));

    expect(sourceLabel).toBe(en.sourcesOther);
    // With no stored filename the label falls back to the same source label.
    expect(label).toBe(en.sourcesOther);
    // The key path must never reach the reader.
    expect(sourceLabel).not.toContain("sources.");
  });

  it("keeps the stored filename as the label even when the source label falls back", () => {
    const withoutPytr = { ...en, sources: { ...(en.sources as Record<string, string>) } };
    delete (withoutPytr.sources as Record<string, string>).pytr;

    const { label } = sourceMeta(record("pytr", "tr-umsatz-2026.csv"), translator(withoutPytr));

    expect(label).toBe("tr-umsatz-2026.csv");
  });

  it("has the fallback in the Indonesian catalogue too", () => {
    const withoutPytr = { ...id, sources: { ...(id.sources as Record<string, string>) } };
    delete (withoutPytr.sources as Record<string, string>).pytr;

    const { sourceLabel } = sourceMeta(record("pytr"), translator(withoutPytr));

    expect(sourceLabel).toBe(id.sourcesOther);
  });
});
