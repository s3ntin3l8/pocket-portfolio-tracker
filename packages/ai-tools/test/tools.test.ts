import { ApiError, type ApiClient } from "@portfolio/api-client";
import { describe, expect, it } from "vitest";
import {
  createTools,
  GLOSSARY,
  isSensitiveKey,
  stripSensitive,
  toJsonSchema,
} from "../src/index.js";
import { downsample } from "../src/compact.js";

// Fixtures deliberately carry every sensitive key so the walker proves none survive.
const P1 = "11111111-1111-1111-1111-111111111111";
const H1 = "22222222-2222-2222-2222-222222222222";
const I1 = "33333333-3333-3333-3333-333333333333";
const leaky = { accountNumber: "DE00-SECRET", iban: "DE89370400440532013000", userId: "u1" };
const holding = (over: Record<string, unknown> = {}) => ({
  instrumentId: "i1",
  quantity: "10",
  avgCost: "100",
  costBasis: "1000",
  realizedPnL: "0",
  costCurrency: "EUR",
  price: "120",
  currency: "EUR",
  marketValue: "1200",
  unrealizedPnL: "200",
  marketValueDisplay: "1200",
  costBasisDisplay: "1000",
  unrealizedPnLDisplay: "200",
  previousClose: null,
  dayChange: null,
  dayChangePct: "0.5",
  instrument: {
    symbol: "ABC",
    name: "ABC Corp",
    displayName: null,
    assetClass: "equity",
    ...leaky,
  },
  lots: [{ ...leaky }],
  sparkline: [1, 2, 3],
  ...over,
});
const summary = {
  displayCurrency: "EUR",
  holdings: [
    holding(),
    holding({ instrumentId: "i2", valuedAtCost: true, marketValueDisplay: "500" }),
  ],
  cash: { EUR: "50" },
  cashTracked: true,
  netWorth: "1750",
  totalCost: "1500",
  totalMarketValue: "1700",
  totalUnrealizedPnL: "200",
  totalRealizedPnL: "10",
  totalLiabilities: "0",
  totalIncome: "5",
  totalDayChange: "1",
  exposureByCurrency: { EUR: "1750" },
  fxMissingCurrencies: ["IDR"],
  allocation: { ...leaky },
  drift: { asset_class: [{ key: "equity", ...leaky }] },
  gain: { boundary: "outside", value: "1750", netContributed: "1500", ...leaky },
};
const history = Array.from({ length: 365 }, (_, i) => ({
  date: `d${i}`,
  value: String(i),
  ...leaky,
}));
const calls: string[] = [];
const rec =
  <T>(name: string, value: T) =>
  async (...args: unknown[]) => {
    calls.push(
      `${name}(${args.map((a) => (a === undefined ? "undefined" : JSON.stringify(a))).join(",")})`,
    );
    return value;
  };

const client = {
  listPortfolios: rec("listPortfolios", [
    {
      id: "p1",
      name: "Depot DE89 3704 0044 0532 0130 00",
      accountHolderId: "h1",
      baseCurrency: "EUR",
      brokerage: "X",
      accountHolder: "Max Mustermann",
      portfolioType: "standard",
      cashCounted: false,
      ...leaky,
    },
  ]),
  getNetWorth: rec("getNetWorth", {
    ...summary,
    xirr: 0.07,
    portfolioCount: 1,
    asOf: "2026-01-01",
    period: "1y",
  }),
  getSummary: rec("getSummary", summary),
  getPerformance: rec("getPerformance", { xirr: 0.05, netWorth: "1750", asOf: "2026-01-01" }),
  listTransactionsPaginated: rec("listTransactionsPaginated", {
    total: 1,
    rows: [
      {
        id: "t1",
        portfolioId: P1,
        instrumentId: "i1",
        type: "buy",
        quantity: "1",
        price: "1",
        fees: "0",
        currency: "EUR",
        description: "SEPA DE89370400440532013000 Max Mustermann",
        executedAt: "2026-01-01",
        ...leaky,
      },
    ],
  }),
  listNetworthTransactionsPaginated: rec("listNetworthTransactionsPaginated", {
    total: 0,
    rows: [],
  }),
  getPortfolioHistory: rec("getPortfolioHistory", history),
  getNetWorthHistory: rec("getNetWorthHistory", history),
  getPortfolioIncome: rec("getPortfolioIncome", { total: "1", ...leaky }),
  getIncome: rec("getIncome", { total: "2", ...leaky }),
  getPortfolioContributions: rec("getPortfolioContributions", { net: "1", ...leaky }),
  getContributions: rec("getContributions", { net: "2", ...leaky }),
  getPortfolioTax: rec("getPortfolioTax", { year: 2026, ...leaky }),
  getNetworthTax: rec("getNetworthTax", [
    {
      holder: {
        id: "h1",
        name: "Max Mustermann",
        taxAllowanceAnnual: "1000",
        capitalGainsTaxRate: null,
        churchTax: null,
        taxResidence: "DE",
      },
      year: 2025,
      ...leaky,
    },
  ]),
  getPortfolioTargets: rec("getPortfolioTargets", [{ key: "equity", weight: 60 }]),
  getNetworthTargets: rec("getNetworthTargets", [{ key: "equity", weight: 70 }]),
  getInsights: rec("getInsights", { drawdown: {}, ...leaky }),
  searchInstruments: rec("searchInstruments", [
    {
      id: "i1",
      symbol: "ABC",
      isin: "X",
      name: "ABC",
      displayName: null,
      assetClass: "equity",
      market: "XETRA",
      currency: "EUR",
      ...leaky,
    },
  ]),
} as unknown as ApiClient;

const tools = createTools(client);
const byName = (n: string) => tools.find((t) => t.name === n)!;
const inputs: Record<string, unknown> = {
  list_portfolios: {},
  get_net_worth: {},
  get_portfolio_summary: { portfolioId: P1 },
  get_holdings: {},
  search_transactions: { portfolioId: P1 },
  get_performance: { portfolioId: P1 },
  get_income: { portfolioId: P1 },
  get_contributions: {},
  get_tax_summary: { year: 2025 },
  "get_tax_summary#portfolio": { portfolioId: P1, year: 2025 },
  get_rebalancing: { dimension: "asset_class" },
  get_insights: {},
  lookup_instrument: { q: "abc" },
};

function keysDeep(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      acc.push(k);
      keysDeep(x, acc);
    }
  return acc;
}

describe("ai-tools", () => {
  it("exposes the documented read-only tool set", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      Object.keys(inputs)
        .filter((n) => !n.includes("#"))
        .sort(),
    );
    for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
  });

  it.each(Object.keys(inputs))("%s never leaks a sensitive key", async (name) => {
    const t = byName(name.split("#")[0]!);
    const out = await t.handler(t.inputSchema.parse(inputs[name]));
    const bad = keysDeep(out).filter(isSensitiveKey);
    expect(bad).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("DE00-SECRET");
    const json = JSON.stringify(out);
    expect(json).not.toContain("DE89370400440532013000");
    expect(json).not.toContain("DE89 3704");
    expect(json).not.toContain("Mustermann");
  });

  it("list_portfolios exposes the holder id, never the holder name", async () => {
    const out = (await byName("list_portfolios").handler({})) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ accountHolderId: "h1" });
    expect(out[0]).not.toHaveProperty("accountHolder");
    expect(out[0]!.name).toBe("Depot [iban]");
  });

  it("tax summary across holders keeps tax parameters but drops the holder name", async () => {
    const out = (await byName("get_tax_summary").handler({ year: 2025 })) as {
      holder: Record<string, unknown>;
    }[];
    expect(out[0]!.holder).toEqual({
      id: "h1",
      taxAllowanceAnnual: "1000",
      capitalGainsTaxRate: null,
      churchTax: null,
      taxResidence: "DE",
    });
  });

  it("passes positional arguments to the client in the right order", async () => {
    calls.length = 0;
    const t = byName("search_transactions");
    await t.handler(
      t.inputSchema.parse({
        portfolioId: P1,
        type: "buy",
        year: "2025",
        q: "x",
        instrumentId: I1,
        page: 2,
        pageSize: 10,
      }),
    );
    await t.handler(
      t.inputSchema.parse({
        type: "buy",
        year: "2025",
        q: "x",
        instrumentId: I1,
        page: 2,
        pageSize: 10,
      }),
    );
    await byName("get_tax_summary").handler({ year: 2025, holderId: H1 });
    expect(calls).toEqual([
      `listTransactionsPaginated("${P1}",2,10,undefined,"buy","2025","x","${I1}")`,
      `listNetworthTransactionsPaginated(2,10,"buy","2025","x","${I1}")`,
      `getNetworthTax(2025,"${H1}")`,
    ]);
  });

  it("portfolio summary merges XIRR from the performance endpoint", async () => {
    const out = (await byName("get_portfolio_summary").handler({ portfolioId: P1 })) as Record<
      string,
      unknown
    >;
    expect(out.xirr).toBe(0.05);
    expect(out.netWorth).toBe("1750");
  });

  it("holdings can be scoped to a holder", async () => {
    calls.length = 0;
    const t = byName("get_holdings");
    await t.handler(t.inputSchema.parse({ holderId: H1 }));
    expect(calls).toEqual([`getNetWorth(undefined,"${H1}")`]);
  });

  it("net worth forwards gain, fx exclusions and at-cost counts; drops the holdings array", async () => {
    const out = (await byName("get_net_worth").handler({})) as Record<string, unknown>;
    expect(out.fxMissingCurrencies).toEqual(["IDR"]);
    expect(out.valuedAtCostCount).toBe(1);
    expect(out.holdingCount).toBe(2);
    expect((out.gain as Record<string, string>).netContributed).toBe("1500");
    expect(out).not.toHaveProperty("holdings");
    expect(out.netWorth).toBe("1750"); // money stays a string
  });

  it("holdings are sorted by value, flag valuedAtCost, and drop lots/sparkline", async () => {
    const t = byName("get_holdings");
    const out = (await t.handler(t.inputSchema.parse({}))) as {
      holdings: Record<string, unknown>[];
    };
    expect(out.holdings.map((h) => h.instrumentId)).toEqual(["i1", "i2"]);
    expect(out.holdings[1]!.valuedAtCost).toBe(true);
    expect(out.holdings[0]).not.toHaveProperty("lots");
    expect(out.holdings[0]).not.toHaveProperty("sparkline");
  });

  it("holdings honours limit and reports truncation", async () => {
    const t = byName("get_holdings");
    const out = (await t.handler(t.inputSchema.parse({ limit: 1 }))) as {
      holdings: unknown[];
      truncated: boolean;
    };
    expect(out.holdings).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it("scopes by portfolioId when given, else uses the net-worth endpoints", async () => {
    calls.length = 0;
    await byName("get_income").handler({ portfolioId: P1 });
    await byName("get_income").handler({});
    expect(calls.some((c) => c.startsWith("getPortfolioIncome"))).toBe(true);
    expect(calls.some((c) => c.startsWith("getIncome"))).toBe(true);
  });

  it("caps series at 60 points and keeps the endpoints", async () => {
    const t = byName("get_performance");
    const out = (await t.handler(t.inputSchema.parse({ portfolioId: P1 }))) as {
      points: { date: string }[];
      totalPoints: number;
    };
    expect(out.totalPoints).toBe(365);
    expect(out.points).toHaveLength(60);
    expect(out.points[0]!.date).toBe("d0");
    expect(out.points.at(-1)!.date).toBe("d364");
  });

  it("rebalancing returns targets and the matching drift dimension", async () => {
    const t = byName("get_rebalancing");
    const out = (await t.handler(t.inputSchema.parse({ dimension: "asset_class" }))) as {
      targets: unknown[];
      drift: unknown[];
    };
    expect(out.targets).toHaveLength(1);
    expect(out.drift).toHaveLength(1);
  });

  it("rejects ids that could escape their URL slot (path/query injection)", () => {
    for (const [name, key] of [
      ["get_portfolio_summary", "portfolioId"],
      ["get_holdings", "holderId"],
      ["search_transactions", "instrumentId"],
    ] as const) {
      const schema = byName(name).inputSchema;
      const base = name === "get_portfolio_summary" ? {} : {};
      for (const bad of ["x/../me/tokens", `${P1}/../../me`, `${P1}?a=b`, "../admin", "p1"]) {
        expect(schema.safeParse({ ...base, [key]: bad }).success).toBe(false);
      }
      expect(schema.safeParse({ [key]: P1 }).success).toBe(true);
    }
  });

  it("rejects bad input (pageSize cap, year format)", () => {
    const t = byName("search_transactions");
    expect(t.inputSchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(t.inputSchema.safeParse({ year: "26" }).success).toBe(false);
  });

  it("produces JSON Schema for every tool", () => {
    for (const t of tools) expect(toJsonSchema(t)).toMatchObject({ type: "object" });
  });

  it("glossary names the invariants", () => {
    expect(GLOSSARY).toMatch(/net contributed/);
    expect(GLOSSARY).toMatch(/valuedAtCost/);
    expect(GLOSSARY).toMatch(/fxMissingCurrencies/);
  });
});

describe("failures", () => {
  it("returns an error code and status, never the raw error or body", async () => {
    const failing = createTools({
      getPortfolioTax: async () => {
        throw new ApiError(422, '{"error":"tax_allowance_not_configured","trace":"SECRET-STACK"}');
      },
      listPortfolios: async () => {
        throw new Error("boom at /srv/app/secret.ts");
      },
    } as unknown as ApiClient);
    const tax = failing.find((t) => t.name === "get_tax_summary")!;
    const out = await tax.handler({ portfolioId: P1 });
    expect(out).toEqual({ error: "tax_allowance_not_configured", status: 422 });
    const list = await failing.find((t) => t.name === "list_portfolios")!.handler({});
    expect(list).toEqual({ error: "tool_failed" });
    expect(JSON.stringify([out, list])).not.toMatch(/SECRET|boom|srv/);
  });
});

describe("redact / compact helpers", () => {
  it("stripSensitive is a deep, non-mutating walk", () => {
    const input = { a: [{ iban: "x", ok: 1, n: { accountNumber: "y", ok: 2 } }], email: "e" };
    const out = stripSensitive(input);
    expect(out).toEqual({ a: [{ ok: 1, n: { ok: 2 } }] });
    expect(input.email).toBe("e");
  });

  it("scrubText redacts IBAN-shaped runs in free text only", () => {
    expect(stripSensitive("pay DE89370400440532013000 now")).toBe("pay [iban] now");
    expect(stripSensitive("GB29 NWBK 6016 1331 9268 19")).toBe("[iban]");
    expect(stripSensitive("ISIN US0378331005 ok")).toBe("ISIN US0378331005 ok");
  });

  it("downsample passes short series through untouched", () => {
    expect(downsample([1, 2, 3], 60)).toEqual({ points: [1, 2, 3], total: 3 });
  });
});

describe("propose_transactions (draft-only write tool)", () => {
  const proposal = {
    transactions: [
      {
        action: "buy" as const,
        name: "ABC Corp",
        quantity: "10",
        price: "100.5",
        currency: "EUR",
        executedAt: "2026-03-02T00:00:00Z",
      },
    ],
  };
  const stub = (res: unknown) =>
    ({
      ...client,
      proposeTransactions: async (body: unknown) => {
        calls.push(`proposeTransactions(${JSON.stringify(body).length})`);
        return res;
      },
    }) as unknown as ApiClient;

  it("is not offered unless the credential may write", () => {
    expect(createTools(client as unknown as ApiClient).map((t) => t.name)).not.toContain(
      "propose_transactions",
    );
    expect(
      createTools(client as unknown as ApiClient, { write: false }).map((t) => t.name),
    ).not.toContain("propose_transactions");
    const tools = createTools(client as unknown as ApiClient, { write: true });
    const propose = tools.find((t) => t.name === "propose_transactions")!;
    expect(propose.readOnly).toBe(false);
    expect(
      tools.filter((t) => t.name !== "propose_transactions").every((t) => !t.readOnly === true),
    ).toBe(true);
    // Every other tool keeps its read-only marker semantics (absent = read only).
    expect(tools.filter((t) => t.readOnly === false)).toHaveLength(1);
  });

  it("tells the model it only creates a draft the user must confirm, and to link the review", () => {
    const propose = createTools(client as unknown as ApiClient, { write: true }).find(
      (t) => t.name === "propose_transactions",
    )!;
    expect(propose.description).toMatch(/DRAFT/);
    expect(propose.description).toMatch(/confirm/);
    expect(propose.description).toMatch(/never guess/i);
    expect(propose.description).toMatch(/reviewUrl/);
  });

  it("has a JSON Schema form (the chat loop and MCP both need one) with every tool", () => {
    for (const t of createTools(client as unknown as ApiClient, { write: true })) {
      expect(() => toJsonSchema(t), t.name).not.toThrow();
    }
    const propose = createTools(client as unknown as ApiClient, { write: true }).find(
      (t) => t.name === "propose_transactions",
    )!;
    const schema = JSON.stringify(toJsonSchema(propose));
    expect(schema).toMatch(/ISO 8601/);
    expect(schema).toMatch(/"additionalProperties":false/);
  });

  it("rejects an invalid date", () => {
    const propose = createTools(client as unknown as ApiClient, { write: true }).find(
      (t) => t.name === "propose_transactions",
    )!;
    const base = proposal.transactions[0]!;
    expect(
      propose.inputSchema.safeParse({ transactions: [{ ...base, executedAt: "31 Feb maybe" }] })
        .success,
    ).toBe(false);
    expect(
      propose.inputSchema.safeParse({ transactions: [{ ...base, executedAt: "2026-03-02" }] })
        .success,
    ).toBe(true);
  });

  it("validates the proposal strictly: unknown fields, empty and oversized lists, unidentified securities", () => {
    const propose = createTools(client as unknown as ApiClient, { write: true }).find(
      (t) => t.name === "propose_transactions",
    )!;
    const ok = propose.inputSchema.safeParse(proposal);
    expect(ok.success).toBe(true);
    const bad = (transactions: unknown[]) =>
      propose.inputSchema.safeParse({ transactions }).success;
    const base = proposal.transactions[0]!;
    expect(bad([])).toBe(false);
    expect(bad(Array.from({ length: 101 }, () => base))).toBe(false);
    expect(bad([{ ...base, externalId: "forged" }])).toBe(false);
    expect(bad([{ ...base, taxComponents: { quellensteuer: "1" } }])).toBe(false);
    expect(bad([{ ...base, confidence: 1 }])).toBe(false);
    expect(bad([{ ...base, name: undefined }])).toBe(false);
    // A cash movement needs no instrument.
    expect(
      bad([{ ...base, action: "deposit", name: undefined, quantity: "1", price: "500" }]),
    ).toBe(true);
    expect(propose.inputSchema.safeParse({ ...proposal, portfolioId: "nope" }).success).toBe(false);
    expect(propose.inputSchema.safeParse({ ...proposal, extra: 1 }).success).toBe(false);
  });

  it("returns the draft summary with a note, and surfaces API failures as safe errors", async () => {
    const created = {
      importId: "imp1",
      draftCount: 1,
      alreadyExists: false,
      alreadyConfirmed: false,
      likelyDuplicates: 0,
      portfolioId: null,
      reviewPath: "/transactions/import/imp1",
    };
    const propose = (api: ApiClient) =>
      createTools(api, { write: true }).find((t) => t.name === "propose_transactions")!;

    const out = (await propose(stub(created)).handler(proposal)) as Record<string, unknown>;
    expect(out).toMatchObject({ importId: "imp1", reviewPath: "/transactions/import/imp1" });
    expect(String(out.note)).toMatch(/still has to review and confirm/);

    const again = (await propose(stub({ ...created, alreadyExists: true })).handler(
      proposal,
    )) as Record<string, unknown>;
    expect(String(again.note)).toMatch(/already waiting/);
    const done = (await propose(stub({ ...created, alreadyConfirmed: true })).handler(
      proposal,
    )) as Record<string, unknown>;
    expect(String(done.note)).toMatch(/already confirmed/);

    const failing = {
      proposeTransactions: async () => {
        throw new ApiError(403, '{"error":"read_only_token"}');
      },
    } as unknown as ApiClient;
    expect(await propose(failing).handler(proposal)).toEqual({
      error: "read_only_token",
      status: 403,
    });
  });
});
