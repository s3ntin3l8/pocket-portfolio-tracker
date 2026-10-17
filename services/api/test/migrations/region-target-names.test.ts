import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migrationsDir } from "@portfolio/db";

function migrationSql(): string {
  const raw = readFileSync(`${migrationsDir}/0094_region_target_names.sql`, "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(";\n");
}

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const P1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Row = { portfolio_id: string | null; dimension: string; target_key: string; pct: string };

describe("0094 region target keys: codes to names", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    // The allocation_targets shape the migration runs against, including the unique index
    // a naive rename would collide with.
    await db.exec(`
      CREATE TABLE allocation_targets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        portfolio_id uuid,
        dimension text NOT NULL,
        target_key text NOT NULL,
        target_pct numeric NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX allocation_targets_scope_dim_key_idx
        ON allocation_targets (user_id, portfolio_id, dimension, target_key);
    `);
  });

  beforeEach(async () => {
    await db.exec("DELETE FROM allocation_targets");
  });

  afterAll(async () => {
    await db.close();
  });

  async function insert(
    user: string,
    portfolio: string | null,
    dimension: string,
    key: string,
    pct: string,
  ) {
    await db.query(
      `INSERT INTO allocation_targets (user_id, portfolio_id, dimension, target_key, target_pct)
       VALUES ($1, $2, $3, $4, $5)`,
      [user, portfolio, dimension, key, pct],
    );
  }

  async function rows(user: string): Promise<Row[]> {
    return (
      await db.query<Row>(
        `SELECT portfolio_id, dimension, target_key, target_pct::text AS pct
         FROM allocation_targets WHERE user_id = $1
         ORDER BY portfolio_id NULLS FIRST, dimension, target_key`,
        [user],
      )
    ).rows;
  }

  it("merges US and CA into one North America target, summing target_pct", async () => {
    await insert(U1, null, "region", "US", "40");
    await insert(U1, null, "region", "CA", "10");
    await insert(U1, null, "region", "EU", "30");
    await insert(U1, null, "region", "ID", "15");
    await insert(U1, null, "region", "Commodity", "5");

    await db.exec(migrationSql());

    expect(await rows(U1)).toEqual([
      { portfolio_id: null, dimension: "region", target_key: "Asia", pct: "15" },
      { portfolio_id: null, dimension: "region", target_key: "Europe", pct: "30" },
      { portfolio_id: null, dimension: "region", target_key: "North America", pct: "50" },
      { portfolio_id: null, dimension: "region", target_key: "Other", pct: "5" },
    ]);
  });

  it("folds a code into a name the same set already holds", async () => {
    await insert(U1, P1, "region", "North America", "25.5");
    await insert(U1, P1, "region", "US", "24.5");
    await insert(U1, P1, "region", "JP", "20");
    await insert(U1, P1, "region", "Asia", "30");

    await db.exec(migrationSql());

    expect(await rows(U1)).toEqual([
      { portfolio_id: P1, dimension: "region", target_key: "Asia", pct: "50" },
      { portfolio_id: P1, dimension: "region", target_key: "North America", pct: "50.0" },
    ]);
  });

  it("keeps the networth-level and per-portfolio sets and other users apart", async () => {
    await insert(U1, null, "region", "US", "100");
    await insert(U1, P1, "region", "CA", "100");
    await insert(U2, null, "region", "EU", "100");

    await db.exec(migrationSql());

    expect(await rows(U1)).toEqual([
      { portfolio_id: null, dimension: "region", target_key: "North America", pct: "100" },
      { portfolio_id: P1, dimension: "region", target_key: "North America", pct: "100" },
    ]);
    expect(await rows(U2)).toEqual([
      { portfolio_id: null, dimension: "region", target_key: "Europe", pct: "100" },
    ]);
  });

  it("leaves other dimensions and sets that already use names untouched", async () => {
    // "US" and "EU" are not region codes outside the region dimension.
    await insert(U1, null, "currency", "USD", "60");
    await insert(U1, null, "currency", "EUR", "40");
    await insert(U1, null, "sector", "US", "100");
    await insert(U1, P1, "region", "Europe", "100");
    const before = (await db.query<{ id: string }>("SELECT id FROM allocation_targets ORDER BY id"))
      .rows;

    await db.exec(migrationSql());

    const after = (await db.query<{ id: string }>("SELECT id FROM allocation_targets ORDER BY id"))
      .rows;
    expect(after).toEqual(before);
    expect(await rows(U1)).toEqual([
      { portfolio_id: null, dimension: "currency", target_key: "EUR", pct: "40" },
      { portfolio_id: null, dimension: "currency", target_key: "USD", pct: "60" },
      { portfolio_id: null, dimension: "sector", target_key: "US", pct: "100" },
      { portfolio_id: P1, dimension: "region", target_key: "Europe", pct: "100" },
    ]);
  });

  it("is idempotent: a re-run changes nothing", async () => {
    await insert(U1, null, "region", "US", "60");
    await insert(U1, null, "region", "SG", "40");

    const sql = migrationSql();
    await db.exec(sql);
    const once = await rows(U1);
    await db.exec(sql);

    expect(await rows(U1)).toEqual(once);
    expect(once).toEqual([
      { portfolio_id: null, dimension: "region", target_key: "Asia", pct: "40" },
      { portfolio_id: null, dimension: "region", target_key: "North America", pct: "60" },
    ]);
  });
});
