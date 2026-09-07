import type { FastifyBaseLogger } from "fastify";
import type { transactions } from "@portfolio/db";
import type { DB } from "../../db/client.js";

export type DbOrTx = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
// `Ctx.db` accepts either the app-wide DB or a transaction handle so that
// cross-source dedup can run inside a write tx (row-locked SELECT … FOR UPDATE
// prevents the racy "two confirms see no overlap, both write" outcome — #B11).
export type Ctx = { db: DbOrTx; log?: FastifyBaseLogger };
export type TxRow = typeof transactions.$inferSelect;
export type TxSource = NonNullable<(typeof transactions.$inferInsert)["source"]>;
export type TxStatus = NonNullable<(typeof transactions.$inferInsert)["status"]>;
