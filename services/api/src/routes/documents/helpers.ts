import type { Multipart } from "@fastify/multipart";

export function fieldValue(entry: Multipart | Multipart[] | undefined): string | undefined {
  const f = Array.isArray(entry) ? entry[0] : entry;
  if (!f || f.type !== "field") return undefined;
  return f.value == null ? undefined : String(f.value);
}
