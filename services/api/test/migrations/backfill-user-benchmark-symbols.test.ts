import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migrationsDir } from "@portfolio/db";

function backfillSql(): string {
  const raw = readFileSync(`${migrationsDir}/0081_backfill_user_benchmark_symbols.sql`, "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(";\n");
}

describe("0081 user_benchmark_symbols backfill", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    // Pre-migration shape: user_preferences has benchmark_symbol, the new table
    // exists but is empty. users table for the ^GSPC defaulting pass.
    await db.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE user_preferences (
        user_id uuid PRIMARY KEY,
        benchmark_symbol text
      );
      CREATE TABLE user_benchmark_symbols (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        symbol text NOT NULL,
        display_name text NOT NULL,
        display_order integer NOT NULL,
        added_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT user_benchmark_symbols_user_symbol_uniq UNIQUE (user_id, symbol)
      );
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("lifts a non-null legacy symbol into the new table at order 0", async () => {
    const u = "11111111-1111-1111-1111-111111111111";
    await db.sql`INSERT INTO users (id) VALUES (${u})`;
    await db.sql`INSERT INTO user_preferences (user_id, benchmark_symbol) VALUES (${u}, '^GDAXI')`;

    await db.exec(backfillSql());

    const rows = (
      await db.query<{ symbol: string; display_order: number; display_name: string }>(
        `SELECT symbol, display_order, display_name FROM user_benchmark_symbols WHERE user_id = '${u}' ORDER BY display_order`,
      )
    ).rows;
    expect(rows).toEqual([{ symbol: "^GDAXI", display_order: 0, display_name: "^GDAXI" }]);
  });

  it("seeds ^GSPC for a user with no legacy symbol set", async () => {
    const u = "22222222-2222-2222-2222-222222222222";
    await db.sql`INSERT INTO users (id) VALUES (${u})`;
    await db.sql`INSERT INTO user_preferences (user_id, benchmark_symbol) VALUES (${u}, NULL)`;

    await db.exec(backfillSql());

    const rows = (
      await db.query<{ symbol: string; display_order: number; display_name: string }>(
        `SELECT symbol, display_order, display_name FROM user_benchmark_symbols WHERE user_id = '${u}'`,
      )
    ).rows;
    expect(rows).toEqual([{ symbol: "^GSPC", display_order: 0, display_name: "S&P 500" }]);
  });

  it("seeds ^GSPC for a user with no user_preferences row at all", async () => {
    const u = "33333333-3333-3333-3333-333333333333";
    await db.sql`INSERT INTO users (id) VALUES (${u})`;

    await db.exec(backfillSql());

    const rows = (
      await db.query<{ symbol: string }>(
        `SELECT symbol FROM user_benchmark_symbols WHERE user_id = '${u}'`,
      )
    ).rows;
    expect(rows).toEqual([{ symbol: "^GSPC" }]);
  });

  it("is idempotent: re-running does not duplicate rows", async () => {
    const u = "44444444-4444-4444-4444-444444444444";
    await db.sql`INSERT INTO users (id) VALUES (${u})`;
    await db.sql`INSERT INTO user_preferences (user_id, benchmark_symbol) VALUES (${u}, '^IXIC')`;

    const sql = backfillSql();
    await db.exec(sql);
    await db.exec(sql);

    const rows = (
      await db.query<{ symbol: string }>(
        `SELECT symbol FROM user_benchmark_symbols WHERE user_id = '${u}'`,
      )
    ).rows;
    expect(rows).toEqual([{ symbol: "^IXIC" }]);
  });
});
