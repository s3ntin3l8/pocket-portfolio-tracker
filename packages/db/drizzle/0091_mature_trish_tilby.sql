ALTER TABLE "transactions" ADD COLUMN "installment_n" smallint;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "closed_at" date;--> statement-breakpoint
CREATE INDEX "transactions_loan_installment_idx" ON "transactions" USING btree ("loan_id","installment_n");
--> statement-breakpoint
-- Backfill the explicit repayment -> installment mapping from the rules the booking job used
-- before it existed. Every statement is guarded by `installment_n IS NULL`, so re-running is a
-- no-op. (1) Job-booked rows carry their installment number in the externalId.
UPDATE "transactions"
SET "installment_n" = ((regexp_match("external_id", '^loan:[0-9a-f-]+:inst:([0-9]+)$'))[1])::smallint
WHERE "installment_n" IS NULL
  AND "type" = 'loan_repayment'
  AND "loan_id" IS NOT NULL
  AND "external_id" ~ '^loan:[0-9a-f-]+:inst:[0-9]+$';
--> statement-breakpoint
-- (2) Import-booked repayments (and anything else linked to a loan) were matched to the
-- earliest installments by count: number them in execution order against the schedule rows no
-- repayment covers yet, which reproduces exactly what the count rule showed as paid.
WITH "sched" AS (
  SELECT l."id" AS "loan_id", (r.value ->> 'n')::int AS "n"
  FROM "loans" l, jsonb_array_elements(l."schedule") AS r
  WHERE jsonb_typeof(l."schedule") = 'array'
),
"free_n" AS (
  SELECT s."loan_id", s."n",
    row_number() OVER (PARTITION BY s."loan_id" ORDER BY s."n") AS "rk"
  FROM "sched" s
  WHERE NOT EXISTS (
    SELECT 1 FROM "transactions" t
    WHERE t."loan_id" = s."loan_id" AND t."type" = 'loan_repayment' AND t."installment_n" = s."n"
  )
),
"todo" AS (
  SELECT t."id", t."loan_id",
    row_number() OVER (PARTITION BY t."loan_id" ORDER BY t."executed_at", t."id") AS "rk"
  FROM "transactions" t
  WHERE t."type" = 'loan_repayment' AND t."loan_id" IS NOT NULL AND t."installment_n" IS NULL
)
UPDATE "transactions" t
SET "installment_n" = f."n"
FROM "todo" d
JOIN "free_n" f ON f."loan_id" = d."loan_id" AND f."rk" = d."rk"
WHERE t."id" = d."id" AND t."installment_n" IS NULL;
