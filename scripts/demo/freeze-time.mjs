/**
 * Node preload (`node --import`) that moves the demo's clock to a fixed instant.
 *
 * With DEMO_NOW set (an ISO instant), `Date.now()` and `new Date()` start at
 * DEMO_NOW and tick from there; everything else on `Date` (parsing, UTC, explicit
 * arguments, instance methods) is untouched. Every demo process shares one real
 * base (DEMO_CLOCK_BASE, epoch ms, set by the instance just before the seed runs),
 * so the seed, the API and Next agree on "now" and timers and expiries still work.
 * Without DEMO_NOW this file does nothing.
 *
 * PGlite runs in-process and reads the same JS clock, so `defaultNow()` columns such
 * as `created_at` follow DEMO_NOW too.
 */

import { frozenDate, parseDemoNow } from "./clock.mjs";

const anchor = parseDemoNow(process.env.DEMO_NOW);
if (anchor !== null) {
  const base = Number(process.env.DEMO_CLOCK_BASE);
  globalThis.Date = frozenDate(Date, anchor, Number.isFinite(base) && base > 0 ? base : Date.now());
}
