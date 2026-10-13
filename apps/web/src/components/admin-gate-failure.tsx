import { ShieldAlert } from "lucide-react";
import { DataState } from "@/components/data-state";
import { retryAfterOf, type DataFailure } from "@/lib/data-status";

/** Rendered by the admin layout/pages when the `me` lookup itself failed (429, expired
 *  session, API down) — never a 404, because the page exists; we just couldn't tell. */
export function AdminGateFailure({ gate }: { gate: DataFailure }) {
  // `icon` is required by DataState but only used for its `empty` status; failure states
  // pick their own (lock / clock / server).
  return <DataState status={gate.status} retryAfter={retryAfterOf(gate)} icon={ShieldAlert} />;
}
