import { describe, it, expect, expectTypeOf, beforeAll, afterAll, vi } from "vitest";
import { closeDb } from "../../src/db/client.js";
import type { IntegrityAbstention, IntegrityFinding } from "@portfolio/api-client";
import { RULES, type Abstention, type Finding } from "../../src/services/integrity/index.js";
import { buildIntegrityApp, loadLedger, type App, type LoadedLedger } from "../integrity/ledger.js";
import { degraded } from "../integrity/ledgers/degraded.js";
import { multiBase } from "../integrity/ledgers/multi-base.js";

// GET /me/integrity: the invariants run in-process with the caller's own credential.

let app: App;
let sign: (sub: string) => Promise<string>;
let l: LoadedLedger;

beforeAll(async () => {
  ({ app, sign } = await buildIntegrityApp());
  // A foreign-base portfolio plus a degraded one cover both the FX and the exclusion paths.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(multiBase.asOf) });
  l = await loadLedger(app, sign, multiBase);
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.RATE_LIMIT_MAX;
});

describe("GET /me/integrity", () => {
  it("reports no findings on consistent data, and which rules it ran", async () => {
    const res = await app.inject({ method: "GET", url: "/me/integrity", headers: l.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.findings).toEqual([]);
    expect(body.portfolioCount).toBe(2);
    // Pinned against the implementations that run, not the id list the report is built from.
    expect(body.rulesRun).toHaveLength(Object.keys(RULES).length);
    expect(body.rulesRun).toEqual(Object.keys(RULES));
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    // The SEK-base depot is not in the display currency, so summing the histories needs FX the
    // check does not do: that rule reports it skipped the data instead of counting as passed.
    // ... and since the per-portfolio series are not collected either, the ordering check says
    // so for each portfolio rather than silently covering only the aggregate series.
    const ids = Object.values(l.portfolioIds);
    expect(body.abstentions).toHaveLength(3);
    expect(body.abstentions).toEqual(
      expect.arrayContaining([
        { rule: "HISTORY_SUMS_PORTFOLIOS", scope: "networth", reason: "foreign_currency" },
        ...ids.map((id) => ({
          rule: "HISTORY_ORDERED",
          scope: `portfolio:${id}`,
          reason: "history_not_collected",
        })),
      ]),
    );
  });

  it("works with a read-scoped personal access token", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: l.headers,
      payload: { name: "integrity", scope: "read" },
    });
    expect(created.statusCode).toBe(201);
    const pat = created.json().token as string;
    const res = await app.inject({
      method: "GET",
      url: "/me/integrity",
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().findings).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/me/integrity" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 502 naming the failing endpoint when a sub-request fails", async () => {
    const real = app.inject.bind(app);
    // The handler calls `app.inject` for each sub-request; the outer request goes through `real`.
    const spy = vi
      .spyOn(app, "inject")
      .mockImplementation(((opts: { url?: string }) =>
        opts.url === "/networth"
          ? Promise.resolve({ statusCode: 500, json: () => ({}) })
          : real(opts as never)) as never);
    const res = await real({ method: "GET", url: "/me/integrity", headers: l.headers });
    spy.mockRestore();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: "integrity_collect_failed",
      detail: "/networth -> 500",
    });
  });

  it("surfaces a finding when the data is inconsistent", async () => {
    const real = app.inject.bind(app);
    // Corrupt only the /networth response the handler sees: its total no longer equals the sum
    // of the portfolios, so NW_SUM_PORTFOLIOS (and the composition rule) must name it.
    const spy = vi.spyOn(app, "inject").mockImplementation((async (opts: { url?: string }) => {
      const res = await real(opts as never);
      if (opts.url !== "/networth") return res;
      const body = res.json();
      return { statusCode: res.statusCode, json: () => ({ ...body, netWorth: "1" }) };
    }) as never);
    const res = await real({ method: "GET", url: "/me/integrity", headers: l.headers });
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    const rules = (res.json().findings as { rule: string }[]).map((f) => f.rule);
    expect(rules).toContain("NW_SUM_PORTFOLIOS");
  });
});

describe("GET /me/integrity on degraded data", () => {
  it("still reports no findings: exclusions are disclosed, not inconsistent", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(degraded.asOf) });
    const d = await loadLedger(app, sign, degraded);
    const res = await app.inject({ method: "GET", url: "/me/integrity", headers: d.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().findings).toEqual([]);
  });
});

describe("the api-client's integrity types", () => {
  // Compile-time (checked by `tsc`, a no-op at runtime): the client's hand-maintained types must
  // describe exactly what the route serializes. A renamed or added field on either side fails
  // `npm run typecheck` here instead of drifting silently.
  it("have the same fields as the payload the route returns", () => {
    expectTypeOf<keyof IntegrityFinding>().toEqualTypeOf<keyof Finding>();
    expectTypeOf<keyof IntegrityAbstention>().toEqualTypeOf<keyof Abstention>();
    expectTypeOf<Finding>().toExtend<IntegrityFinding>();
    expectTypeOf<Abstention>().toExtend<IntegrityAbstention>();
  });
});
