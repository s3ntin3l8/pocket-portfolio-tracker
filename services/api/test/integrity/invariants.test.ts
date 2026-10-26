import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeDb } from "../../src/db/client.js";
import { checkIntegrity, collectBodies } from "../../src/services/integrity/index.js";
import { buildIntegrityApp, loadLedger, type App, type LoadedLedger } from "./ledger.js";
import { allLedgers } from "./ledgers/index.js";

// The cross-endpoint invariants must hold on every golden ledger, whatever its shape.

let app: App;
let sign: (sub: string) => Promise<string>;

beforeAll(async () => {
  ({ app, sign } = await buildIntegrityApp());
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.RATE_LIMIT_MAX;
});

describe.each(allLedgers.map((l) => [l.name, l] as const))(
  "invariants hold on %s",
  (_name, ledger) => {
    let l: LoadedLedger;
    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(ledger.asOf) });
      l = await loadLedger(app, sign, ledger);
    }, 60_000);

    it("reports no findings", async () => {
      const bodies = await collectBodies(async (url) => {
        const res = await app.inject({ method: "GET", url, headers: l.headers });
        if (res.statusCode !== 200) throw new Error(`${url} -> ${res.statusCode}`);
        return res.json();
      });
      expect(checkIntegrity(bodies)).toEqual([]);
    });
  },
);
