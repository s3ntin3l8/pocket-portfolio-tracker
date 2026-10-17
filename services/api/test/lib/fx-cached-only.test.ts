import { describe, it, expect } from "vitest";
import {
  cachedOnlyKeySuffix,
  isFxCachedOnly,
  runInFxCachedOnlyScope,
} from "../../src/lib/fx-cached-only.js";
import { createStore, withDerivationCache } from "../../src/lib/derivation-cache.js";
import { derivationCacheKey } from "../../src/services/valuation.js";
import { defaultFxProvider } from "../../src/services/fx.js";

// A configured provider (resolved lazily on first use), so "cached-only" is observable: the
// test environment otherwise has none at all.
process.env.FX_BASE_URL = "https://fx.test/latest";

/** Run `fn` inside a cached-only scope whose check returns `cachedOnly`. */
function inScope<T>(cachedOnly: boolean, fn: () => Promise<T> | T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    runInFxCachedOnlyScope(
      () => cachedOnly,
      () => {
        Promise.resolve().then(fn).then(resolve, reject);
      },
    );
  });
}

// Audit A7: a read-scoped PAT's request loads FX cached-only, and every cache keys its
// results apart so a possibly-degraded result is never served to a session.
describe("request-scoped cached-only FX", () => {
  it("is off outside a request scope and follows the scope's check inside one", async () => {
    expect(isFxCachedOnly()).toBe(false);
    expect(cachedOnlyKeySuffix()).toBe("");
    expect(await inScope(true, () => [isFxCachedOnly(), cachedOnlyKeySuffix()])).toEqual([
      true,
      ":ro",
    ]);
    expect(await inScope(false, () => [isFxCachedOnly(), cachedOnlyKeySuffix()])).toEqual([
      false,
      "",
    ]);
  });

  it("evaluates the check lazily, on every ask (request.user is set after onRequest)", async () => {
    let readOnly = false;
    const seen = await new Promise<boolean[]>((resolve) => {
      runInFxCachedOnlyScope(
        () => readOnly,
        () => {
          const out = [isFxCachedOnly()];
          readOnly = true;
          setTimeout(() => resolve([...out, isFxCachedOnly()]), 0);
        },
      );
    });
    expect(seen).toEqual([false, true]);
  });

  it("makes defaultFxProvider() cached-only (null) inside a cached-only scope", async () => {
    expect(defaultFxProvider()).not.toBeNull();
    expect(await inScope(false, () => defaultFxProvider())).not.toBeNull();
    expect(await inScope(true, () => defaultFxProvider())).toBeNull();
  });

  it("keys the valuation (and FIFO trade-log) cache apart for a cached-only request", async () => {
    const session = await inScope(false, () => derivationCacheKey("pf", "IDR", undefined, true));
    const readPat = await inScope(true, () => derivationCacheKey("pf", "IDR", undefined, true));
    expect(session).toBe(derivationCacheKey("pf", "IDR", undefined, true));
    expect(readPat).not.toBe(session);
  });

  it("keeps withDerivationCache entries apart for a cached-only request", async () => {
    const store = createStore<string>();
    let computed = 0;
    const compute = (label: string) => async () => {
      computed++;
      return label;
    };
    const ro = await inScope(true, () => withDerivationCache(store, "k", compute("ro")));
    const rw = await inScope(false, () => withDerivationCache(store, "k", compute("rw")));
    expect([ro, rw]).toEqual(["ro", "rw"]);
    expect(computed).toBe(2);
    // Each side still hits its own entry.
    expect(await inScope(true, () => withDerivationCache(store, "k", compute("x")))).toBe("ro");
    expect(await inScope(false, () => withDerivationCache(store, "k", compute("x")))).toBe("rw");
    expect(computed).toBe(2);
  });
});
