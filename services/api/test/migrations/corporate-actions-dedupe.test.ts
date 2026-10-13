import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migrationsDir } from "@portfolio/db";

// Migration 0090 (audit D7) must dedupe existing corporate_actions rows before adding the
// unique constraint, otherwise it would fail on a database that already holds duplicates.
describe("corporate_actions dedupe + unique migration", () => {
  it("keeps the earliest row per group, then enforces uniqueness (NULLS NOT DISTINCT)", async () => {
    const file = readdirSync(migrationsDir).find((f) => f.startsWith("0090_"));
    if (!file) throw new Error("0090 migration not found");
    const stmts = readFileSync(`${migrationsDir}/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    const db = new PGlite();
    await db.exec(`
      CREATE TABLE corporate_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        instrument_id uuid NOT NULL,
        type text NOT NULL,
        ratio numeric NOT NULL,
        ex_date date NOT NULL,
        portfolio_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const i = "11111111-1111-1111-1111-111111111111";
    const p1 = "22222222-2222-2222-2222-222222222222";
    const p2 = "33333333-3333-3333-3333-333333333333";
    await db.exec(`
      INSERT INTO corporate_actions (id, instrument_id, type, ratio, ex_date, portfolio_id, created_at) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001', '${i}', 'split', 2, '2026-01-01', NULL, '2026-01-02'),
        ('aaaaaaaa-0000-0000-0000-000000000002', '${i}', 'split', 2, '2026-01-01', NULL, '2026-01-03'),
        ('aaaaaaaa-0000-0000-0000-000000000003', '${i}', 'merger', 1, '2026-01-01', '${p1}', '2026-01-02'),
        ('aaaaaaaa-0000-0000-0000-000000000004', '${i}', 'merger', 1, '2026-01-01', '${p2}', '2026-01-02');
    `);
    for (const s of stmts) await db.exec(s);

    const rows = await db.query<{ id: string }>("SELECT id FROM corporate_actions ORDER BY id");
    expect(rows.rows.map((r) => r.id)).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000001",
      "aaaaaaaa-0000-0000-0000-000000000003",
      "aaaaaaaa-0000-0000-0000-000000000004",
    ]);
    await expect(
      db.exec(
        `INSERT INTO corporate_actions (instrument_id, type, ratio, ex_date) VALUES ('${i}', 'split', 5, '2026-01-01')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
    await db.close();
  });
});
