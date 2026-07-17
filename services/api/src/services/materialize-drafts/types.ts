import type { FastifyBaseLogger } from "fastify";
import type { transactions } from "@portfolio/db";
import type { DB } from "../../db/client.js";

export type DbOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Ctx = { db: DB; log?: FastifyBaseLogger };
export type TxRow = typeof transactions.$inferSelect;
export type TxSource = NonNullable<(typeof transactions.$inferInsert)["source"]>;
export type TxStatus = NonNullable<(typeof transactions.$inferInsert)["status"]>;
