# Analysis integrity

How we check that the numbers the app derives (holdings, P&L, contributions, XIRR/TWR, net
worth, tax) are right — with evidence instead of "this looks wrong". Four layers, all under
`services/api/`; the first three run in CI, the fourth runs against your own data.

| Layer                   | What it checks                                                      | Needs expected values? |
| ----------------------- | ------------------------------------------------------------------- | ---------------------- |
| **A. Golden ledgers**   | Fixed-date scenarios whose figures are derived by hand              | yes (hand-derived)     |
| **B. Invariants**       | Identities between endpoints that hold for _any_ data               | no                     |
| **C. Metamorphic**      | Change the input in a known way → the output changes in a known way | no                     |
| **D. Real-data report** | Layer B, run read-only against a real account                       | no                     |

## A. Golden ledgers (`test/integrity/`)

A `Ledger` (`ledger.ts`) is a declarative scenario: portfolios, instruments with a quote, FX
rates, split corporate actions, and transactions — every date absolute, ids symbolic.
`loadLedger` inserts it for a fresh user; `golden.test.ts` freezes the clock at the ledger's
`asOf` (`vi.useFakeTimers({ toFake: ["Date"] })`, because routes call `new Date()`) and
asserts the endpoint figures.

**The oracle rule: expected values are derived by hand, never pasted from a run.** Each
ledger carries the arithmetic in a comment (`// 780 − 640 = 140 realized`). A value copied from
the code under test turns the test into a snapshot that can only ever agree with the code.

Pitfalls the loader already handles, and two it can't (the second is the next subsection):

- A `last_prices` row is only trusted while younger than the price-cache TTL; the loader stamps
  quotes at the ledger's `asOf`. Otherwise the holding silently falls back to cost.
- Instrument symbols are namespaced per ledger. `fx_rates` rows are **global**: a ledger that
  needs an absent or stale pair must use a currency no other ledger quotes.
- A figure derived from an average-cost pool is exact only to ~1e-15 — see "Average-cost
  precision" below.

### Average-cost precision

A cost basis that comes out of the average-cost pool is not always the exact decimal you would
write by hand. Example (`eur-basic`): 15 shares cost 1,600, so the average cost is `1600/15`; the
sale of 6 removes `6 × avg` and the remaining cost is `1600 − that`. With `decimal.js` at its 20
significant digits:

```
1600 / 15            = 106.66666666666666667
6 × 106.666…667      = 640.00000000000000002   (cost of the 6 sold)
1600 − 640.0…0002    = 959.99999999999999998   (cost of the 9 left; 960 by hand)
```

The raw API string is therefore `959.99999999999999998`; the display layers round it to `960`.
(Multiplying `1600/15` by 9 directly gives a different last digit; the string depends on the
path the pool takes, which is the point.)

This is a deliberate decision (#1159), not an open bug: rounding the pool at a fixed scale would
touch every cost basis in the app, and every golden ledger, for no gain. Instead:

- golden ledgers compare pool-derived figures with an absolute `1e-12` tolerance and everything
  else exactly (`expectDecimal`);
- the invariant rules compare with a **relative** `1e-9` tolerance and an absolute floor of
  `1e-9` (so sub-unit figures stay comparable), i.e. `max(1e-9, 1e-9 × |expected|)`;
- application code must never compare two such strings for equality: compare them as decimals
  with a tolerance.

Adding a ledger: create `ledgers/<name>.ts` exporting the `Ledger` and its expected figures,
assert them in `golden.test.ts`, and add it to `ledgers/index.ts` so the invariant suite and
the metamorphic relations (where it fits) run on it too.

## B. Invariants (`src/services/integrity/`)

Pure functions over already-fetched response bodies; each returns findings
`{ rule, scope, expected, actual, diff, tolerance, message }`. A rule exists only if it follows
from a documented definition — an identity that fees, taxes or boundaries legitimately break
(e.g. `value − contributed = unrealized + realized + income`) would report false positives on
real data and is deliberately absent. A live figure is never compared with a stored series
(`/networth` vs. the last `/networth/history` point is not an invariant).

| Rule                      | Holds because                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NW_SUM_PORTFOLIOS`       | `/networth` = Σ portfolio summaries, each converted at today's rate (abstains if a rate is missing: the app excludes it too)                                                                                                                                                                                                                    |
| `GAIN_MATCHES_TOTALS`     | `GainSummary` is built from the same valuation's totals                                                                                                                                                                                                                                                                                         |
| `HOLDINGS_SUM`            | totals are the sums of the holdings' display figures (null = excluded)                                                                                                                                                                                                                                                                          |
| `NW_COMPOSITION`          | net worth = market value + counted cash − liabilities                                                                                                                                                                                                                                                                                           |
| `FX_MISSING_DISCLOSED`    | a holding that couldn't be converted is named in `fxMissingCurrencies`                                                                                                                                                                                                                                                                          |
| `VALUED_AT_COST_NO_GAIN`  | a holding valued at cost has no measured gain                                                                                                                                                                                                                                                                                                   |
| `CONTRIB_PARITY`          | the Savings page's `netContributed` is `gain.netContributed`, on the same boundary (abstains if the endpoint answers in another currency)                                                                                                                                                                                                       |
| `REALIZED_PARITY`         | the trade log's `totalRealized` is the valuation's `totalRealizedPnL` (both use the default average-cost method)                                                                                                                                                                                                                                |
| `ANOMALY_UNION`           | `/networth/anomalies` is the union of every portfolio's `/anomalies`, keyed by code, transaction, instrument and `meta`                                                                                                                                                                                                                         |
| `HISTORY_ORDERED`         | every stored-snapshot series (`/networth/history`, `/portfolios/:id/history`) has strictly ascending, unique dates                                                                                                                                                                                                                              |
| `HISTORY_SUMS_PORTFOLIOS` | the aggregate history's `netWorth` at a date is the plain sum of that date's portfolio snapshots (a portfolio counts only on dates it has one); only when every portfolio is already in the display currency, otherwise it abstains. `marketValue` is deliberately not compared: the aggregate carries a gap leg's last value forward by design |

Deliberately absent: an Income-page parity rule (the Income page counts only dividend/coupon
rows while the summary's income also includes interest, bonus cash and tax debits — a real
inconsistency tracked in #1167 that would fire on any account with cash interest), and a
Tax↔Trades Vorabpauschale rule (it depends on year, cost-basis method and the fund's
Teilfreistellung, so it stays a scenario test: `tax-vorab-estimate-surfaces.test.ts`).

`collectBodies(get)` fetches what the rules read through any `get(url)`; it validates the
shapes it depends on and fails naming the endpoint and field instead of defaulting into
something a rule would read as fine. Every rule has a negative test
(`test/services/integrity-rules.test.ts`); the suite must report nothing on every golden ledger
and on the demo dataset.

## C. Metamorphic relations (`test/integrity/metamorphic*.ts`)

Transforms of a ledger with a known effect, each loaded as a separate user at the same clock:

- `INSERT_ORDER` — insertion order changes nothing.
- `SCALE_QTY` — ×3 quantities and amounts scale every money figure (totals and per-holding) by 3;
  XIRR is unchanged.
- `ROUNDTRIP_CASH` — a same-instant deposit + withdrawal changes nothing.
- `SPLIT_PORTFOLIO` — moving shares to a second depot (`transfer_out` → `transfer_in` at carried
  cost) leaves the aggregate value, gains, contribution and XIRR unchanged.
- `SPLIT_EQUIVALENCE` — a 2:1 split equals buying twice the shares at half the price.

A failing relation is either a bug (file it) or a relation that isn't an invariant (document
why next to the test). Never loosen it silently.

## D. Real-data report

```sh
POCKET_TOKEN=pt_... npm run integrity              # API at http://localhost:3000
POCKET_API_URL=https://api.example.com POCKET_TOKEN=pt_... make integrity
npm run integrity -- --json
```

`GET /me/integrity` runs layer B in-process with the caller's own credential. A **read-scoped**
PAT is enough (it only issues GETs, and loads FX from cached rates like any other read). Exit
code: `0` no findings, `1` findings, `2` the check could not run.

**"No findings" is not "everything holds".** A rule that cannot compare some data skips it and
reports an _abstention_ instead: `no_fx_rate` (the app has no rate for a currency the comparison
needs), `currency_mismatch` (two pages answer in different currencies), `not_available` (the
figure is absent from the response), `foreign_currency` / `history_not_collected` (the history
sum is only checked when every portfolio is in the display currency). `rulesRun` lists every rule
attempted; `abstentions` lists where one did not compare, and those scopes are **not** known to
be consistent. Every rule that skips data reports it, and all three surfaces show them; none calls a run with skips a full pass.

A finding is **evidence**, not a verdict: it says which rule broke, on which scope, with
expected vs. actual. Whether the rule or the number is wrong is for you to decide — read the
rule's definition above, and if the app is wrong, reproduce it as a golden ledger. Findings
contain amounts: keep the output local; don't paste it into issues or PRs.

The same check is reachable from two more places, both through the typed client's
`getIntegrityReport()` (long timeout: it values every portfolio):

- **Settings › Data & connections › Data checks** runs it on demand and lists each finding with
  the rule's plain-language meaning, its scope and the API's own expected/actual/difference. A
  failed run is shown as an error, and a run that skipped data lists what was skipped instead of
  showing the green all-clear.
- **MCP tool `check_integrity`** (read-only; `docs/mcp.md`) returns up to 20 findings plus a
  count. Its description tells the model to report them as given and never recompute: a finding
  is evidence, not a verdict.

Known limit: `NW_SUM_PORTFOLIOS` converts each summary by `/fx-rate` while `/networth` converts
each holding from its native currency. They agree while every rate comes from the same provider
day; a degraded FX provider can split them by real FX movement, which is a freshness signal
rather than a calculation bug.
