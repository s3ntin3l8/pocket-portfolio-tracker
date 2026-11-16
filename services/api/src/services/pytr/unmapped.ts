import type { ImportIssue } from "@portfolio/schema";

export interface UnmappedGroup {
  eventType: string | null;
  code: NonNullable<ImportIssue["code"]>;
  message: string;
  count: number;
  lastSeen: Date;
  sample: ImportIssue["raw"] | null;
}

/**
 * Group the unmapped / unparseable broker events recorded in imports' `parsed_json.errors`.
 * One source for `/imports/unmapped-types` and the `unmapped_broker_events` portfolio anomaly,
 * so the two cannot disagree. Discarded imports contribute nothing; groups are keyed by
 * code + (eventType, falling back to the message) and sorted most-frequent first.
 */
export function groupUnmappedEvents(
  rows: { status: string; createdAt: Date; parsedJson: unknown }[],
): UnmappedGroup[] {
  const byKey = new Map<string, UnmappedGroup>();
  for (const r of rows) {
    if (r.status === "discarded") continue;
    const parsed = (r.parsedJson ?? {}) as { errors?: ImportIssue[] };
    for (const e of parsed.errors ?? []) {
      if (e.code !== "unmapped_event_type" && e.code !== "unparseable_event") continue;
      const key = `${e.code}:${e.eventType ?? e.message}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        if (r.createdAt > existing.lastSeen) existing.lastSeen = r.createdAt;
      } else {
        byKey.set(key, {
          eventType: e.eventType ?? null,
          code: e.code,
          message: e.message,
          count: 1,
          lastSeen: r.createdAt,
          sample: e.raw ?? null,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
}
