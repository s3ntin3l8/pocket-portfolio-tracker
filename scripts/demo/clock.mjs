/**
 * The demo's clock: pure helpers, safe to import anywhere. `freeze-time.mjs` is the
 * preload that applies them to a process.
 */

/** DEMO_NOW as epoch ms, or null when unset. Throws on anything but an ISO instant. */
export function parseDemoNow(value) {
  if (value === undefined || value === "") return null;
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value)
    : NaN;
  if (Number.isNaN(ms))
    throw new Error(
      `DEMO_NOW must be an ISO instant with a zone, e.g. 2026-10-15T10:00:00Z, got "${value}"`,
    );
  return ms;
}

/**
 * A stand-in for `RealDate` whose "now" is `anchorMs + (real now - realBaseMs)`.
 * A Proxy rather than a subclass, so `Date()` called as a function still works and
 * `instanceof Date` holds for dates made before the swap.
 */
export function frozenDate(RealDate, anchorMs, realBaseMs) {
  const offset = anchorMs - realBaseMs;
  const now = () => RealDate.now() + offset;
  return new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, prop) => (prop === "now" ? now : Reflect.get(target, prop, target)),
  });
}
