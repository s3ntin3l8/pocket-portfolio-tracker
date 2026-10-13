/** Rows per multi-row INSERT ... ON CONFLICT statement (audit D3/D6). */
export const UPSERT_CHUNK_SIZE = 500;

/** Split `items` into consecutive slices of at most `size`. */
export function chunk<T>(items: readonly T[], size: number = UPSERT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
