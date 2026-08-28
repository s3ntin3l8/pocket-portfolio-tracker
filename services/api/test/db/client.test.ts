import { describe, it, expect } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrationsDir } from "@portfolio/db";
import { initDb, warmPool, addsEnumValue } from "../../src/db/client.js";

describe("warmPool", () => {
  it("is a no-op under PGlite (no real pool to warm) and never throws", async () => {
    // Tests always run against embedded PGlite (see usePglite()), so `sql` is never
    // set — warmPool must resolve immediately instead of erroring on a null client.
    await initDb();
    await expect(warmPool()).resolves.toBeUndefined();
    await expect(warmPool(1)).resolves.toBeUndefined();
  });
});

describe("addsEnumValue", () => {
  it("matches ALTER TYPE ... ADD VALUE statements, case-insensitively, across whitespace", () => {
    expect(addsEnumValue(`ALTER TYPE "public"."transaction_source" ADD VALUE 'pdf';`)).toBe(true);
    expect(addsEnumValue(`alter type "x" add\n  value 'y';`)).toBe(true);
  });

  it("does not match ordinary DDL/DML statements", () => {
    expect(addsEnumValue(`CREATE TABLE "loans" ("id" uuid PRIMARY KEY);`)).toBe(false);
    expect(addsEnumValue(`UPDATE "transactions" SET "source" = 'pdf' WHERE true;`)).toBe(false);
  });

  it("ignores mentions inside SQL comments, only matching executable statements", () => {
    // Near-miss regression case: 0030's own header comment mentions "ALTER TYPE" and
    // "newly-added enum value" without containing an actual ALTER TYPE statement.
    const commentOnly = `-- Must be a separate migration from the ALTER TYPE that added
-- 'bonus_cash' because Postgres does not allow using a newly-added enum value.
UPDATE transactions SET type = 'bonus_cash' WHERE type = 'interest';`;
    expect(addsEnumValue(commentOnly)).toBe(false);

    // A real ALTER TYPE statement must still match even with a trailing comment.
    const withComment = `ALTER TYPE "public"."transaction_type" ADD VALUE 'tax'; -- see #123`;
    expect(addsEnumValue(withComment)).toBe(true);
  });

  it("classifies statements in the real migrationsDir consistently with each file's intent", () => {
    const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
    const filesWithAnyMatch = migrations.filter((m) => m.sql.some(addsEnumValue));

    // Every migration that has ever added an enum value in this repo's history must
    // still be detected — a regression here silently reintroduces 55P04 on fresh
    // Postgres bootstraps.
    expect(filesWithAnyMatch.length).toBeGreaterThanOrEqual(9);

    // 0018 mixes two enum adds with 8 unrelated DDL statements (CREATE TABLE, FKs,
    // indexes) — those 8 must stay classified as non-enum so they keep running inside
    // the per-file transaction instead of losing atomicity like the enum adds do.
    const loans = migrations.find((m) => m.sql.some((s) => s.includes('"loans"')));
    expect(loans).toBeDefined();
    const nonEnumCount = loans!.sql.filter((s) => !addsEnumValue(s)).length;
    expect(nonEnumCount).toBe(8);
  });
});
