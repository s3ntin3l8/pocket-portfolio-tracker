import { buildDailyValueFlows, type CoreTransaction, type CorporateAction } from "../src/index.js";

/**
 * Synthetic multi-year portfolio for the historical backfill's hot loop
 * (`buildDailyValueFlows`): 10 years of weekdays, 20 instruments, ~3k transactions
 * (buys, sells, depot transfers) and a handful of splits. Deterministic (no RNG).
 * Plain timing script (this Vitest major has no `bench`): `npm run bench --workspace @portfolio/core`.
 */
const START = Date.UTC(2016, 0, 4);
const DAY = 86_400_000;
const INSTRUMENTS = Array.from({ length: 20 }, (_, i) => `inst-${i}`);

function key(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const dates: string[] = [];
for (let ms = START; ms < START + 10 * 365 * DAY; ms += DAY) {
  const dow = new Date(ms).getUTCDay();
  if (dow !== 0 && dow !== 6) dates.push(key(ms));
}

const transactions: CoreTransaction[] = [];
for (let n = 0; n < 3000; n++) {
  const id = INSTRUMENTS[n % INSTRUMENTS.length]!;
  const executedAt = new Date(`${dates[(n * 7) % dates.length]}T10:00:00.000Z`);
  const phase = n % 10;
  const type = phase === 9 ? "sell" : phase === 8 ? "transfer_in" : "buy";
  transactions.push({
    instrumentId: id,
    type,
    quantity: type === "sell" ? "1" : "5",
    price: String(50 + (n % 40)),
    fees: "1",
    currency: "EUR",
    executedAt,
  });
}
transactions.sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

const corporateActions: CorporateAction[] = [3, 8, 14].map((i, k) => ({
  instrumentId: INSTRUMENTS[i]!,
  type: "split" as const,
  ratio: "2",
  exDate: new Date(Date.UTC(2019 + k * 2, 5, 1)),
}));

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const timings: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  const flows = buildDailyValueFlows({
    transactions,
    corporateActions,
    dates,
    priceAt: (id, date) => ({
      close: String(40 + ((id.length * 7 + Number(date.slice(2, 4)) * 3) % 30)),
      currency: "EUR",
    }),
    fxAt: () => () => "1",
    baseCurrency: "EUR",
    kindOf: () => "realSeries",
  });
  timings.push(performance.now() - t0);
  if (flows.length !== dates.length) throw new Error("unexpected flow count");
}
timings.sort((a, b) => a - b);
console.log(
  `buildDailyValueFlows: ${dates.length} days, ${transactions.length} tx, ${INSTRUMENTS.length} instruments — ` +
    `median ${timings[Math.floor(RUNS / 2)]!.toFixed(0)} ms (min ${timings[0]!.toFixed(0)}, max ${timings[RUNS - 1]!.toFixed(0)}, n=${RUNS})`,
);
