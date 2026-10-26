import type { Ledger } from "../ledger.js";
import { eurBasic } from "./eur-basic.js";
import { cashInside } from "./cash-inside.js";
import { transfers } from "./transfers.js";
import { split } from "./split.js";
import { usdFx } from "./usd-fx.js";
import { degraded } from "./degraded.js";
import { fxCarry, fxStale } from "./fx-carry.js";
import { multiBase } from "./multi-base.js";
import { metaBase } from "./meta-base.js";
import { anomalies } from "./anomalies.js";
import { deTax } from "./de-tax.js";
import { deTaxPots } from "./de-tax-pots.js";

/** Every golden ledger; the invariant suite must hold on all of them. */
export const allLedgers: Ledger[] = [
  eurBasic,
  cashInside,
  transfers,
  split,
  usdFx,
  degraded,
  fxCarry,
  fxStale,
  multiBase,
  metaBase,
  anomalies,
  deTax,
  deTaxPots,
];
