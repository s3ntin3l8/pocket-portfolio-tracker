DROP INDEX "documents_import_id_idx";--> statement-breakpoint
DROP INDEX "documents_transaction_id_idx";--> statement-breakpoint
CREATE INDEX "documents_import_id_status_idx" ON "documents" USING btree ("import_id","status");--> statement-breakpoint
CREATE INDEX "documents_transaction_id_status_idx" ON "documents" USING btree ("transaction_id","status");
