import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";
import { SourceChips } from "../src/components/transactions-table/utils";
import type { TxRow } from "../src/components/transactions-table/types";
import { anomalyLabel } from "../src/lib/utils";

/**
 * Audit R4-F7 regression guard: a DYNAMIC translation key (`t(\`…\`)`) can't be verified by
 * next-intl at build time, and a key that isn't in the catalogue renders the key path (or
 * throws) instead of a word. Every dynamic site must therefore ask `t.has()` first and fall
 * back to a catalogue key that EXISTS — never to a raw literal.
 */

const ROW: TxRow = {
  id: "tx-1",
  portfolioId: "p1",
  type: "buy",
  quantity: "10",
  price: "100",
  fees: "0",
  currency: "EUR",
  executedAt: "2026-02-01T00:00:00.000Z",
  source: "screenshot",
  instrument: null,
};

function SourceChipsHarness({ tx }: { tx: TxRow }) {
  const t = useTranslations("Transactions");
  return <SourceChips tx={tx} t={t} chipClassName="chip" />;
}

function renderChips(tx: TxRow) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SourceChipsHarness tx={tx} />
    </NextIntlClientProvider>,
  );
}

/**
 * A stand-in for next-intl's translator over the `Anomalies` namespace: `has` answers
 * "is this key in the catalogue", `t` resolves it (and interpolates `{placeholder}`s).
 */
function anomalyTranslator(catalogue: Record<string, unknown>) {
  const codes = (catalogue.codes ?? {}) as Record<string, string>;
  const t = (key: string, values?: Record<string, string>) => {
    const message = codes[key.replace(/^codes\./, "")];
    if (message === undefined) throw new Error(`missing message: ${key}`);
    return message.replace(/\{(\w+)\}/g, (_match, name: string) => values?.[name] ?? "");
  };
  return Object.assign(t, { has: (key: string) => key.replace(/^codes\./, "") in codes });
}

describe("dynamic translation keys fall back instead of rendering the key path", () => {
  it("renders the catalogue fallback for a source type that isn't in the catalogue", () => {
    renderChips({ ...ROW, source: "broker_sync" });

    expect(screen.getByText(messages.Transactions.sourcesOther)).toBeTruthy();
    // The key path must never reach the reader.
    expect(screen.queryByText(/sources\./)).toBeNull();
  });

  it("still renders the real label for a source type that IS in the catalogue", () => {
    renderChips({ ...ROW, source: "pytr" });

    expect(screen.getByText(messages.Transactions.sources.pytr)).toBeTruthy();
  });

  it("renders the catalogue fallback for an anomaly code that isn't in the catalogue", () => {
    const ta = anomalyTranslator(messages.Anomalies);

    expect(anomalyLabel({ code: "some_new_code" }, ta, "en")).toBe(
      messages.Anomalies.codes.unknown,
    );
    // A known code keeps its own message.
    expect(anomalyLabel({ code: "oversell" }, ta, "en")).toBe(messages.Anomalies.codes.oversell);
  });

  it("renders the Indonesian fallback for an anomaly code that isn't in the catalogue", () => {
    const ta = anomalyTranslator(idMessages.Anomalies);

    expect(anomalyLabel({ code: "some_new_code" }, ta, "id")).toBe(
      idMessages.Anomalies.codes.unknown,
    );
  });

  /**
   * The fallback of every guarded family must exist in BOTH catalogues — a fallback that
   * isn't there renders a key path just like the dynamic key did.
   */
  it("has a fallback key in both catalogues for every guarded dynamic family", () => {
    const fallbacks: [string, string][] = [
      ["Transactions", "sourcesOther"],
      ["Transactions.merge", "blockedOther"],
      ["Tax", "cashSourceOther"],
      ["Tax.id", "categoryOther"],
      ["Tax.id", "notesOther"],
      ["Import", "stepsOther"],
      ["Import", "fileStatusOther"],
      ["Trades", "statusOther"],
      ["Instrument", "recommendationOther"],
      ["Anomalies.codes", "unknown"],
    ];

    const missing: string[] = [];
    for (const [namespace, key] of fallbacks) {
      for (const [locale, catalogue] of [
        ["en", messages],
        ["id", idMessages],
      ] as const) {
        const value = namespace
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogue);
        const message = (value as Record<string, unknown> | undefined)?.[key];
        if (typeof message !== "string" || message.trim() === "") {
          missing.push(`${locale}:${namespace}.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * Every dynamic key built from a TEMPLATE LITERAL (`t(\`…\`)`) must be guarded by a
 * `t.has()` on the same expression. Keys passed as a plain identifier (`t(key)`) are the
 * "typed map" case the audit allows — they come from a closed set the compiler checks.
 */
describe("dynamic translation keys are guarded", () => {
  it("guards every template-literal t() call in the web app", () => {
    const unguarded: string[] = [];

    for (const file of walk(SRC)) {
      // Collapse the file to one line so a guard that sits on the line above still counts.
      const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
      for (const match of text.matchAll(/\bt\(`/g)) {
        const before = text.slice(Math.max(0, match.index - 400), match.index);
        if (!before.includes("t.has(")) {
          unguarded.push(
            `${path.relative(SRC, file)}: ${text.slice(match.index, match.index + 60)}`,
          );
        }
      }
    }

    expect(unguarded).toEqual([]);
  });
});
