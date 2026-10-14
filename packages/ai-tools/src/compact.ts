/** Keep the first and last point and an even spread between — a series is shape, not rows. */
export function downsample<T>(points: readonly T[], max = 60): { points: T[]; total: number } {
  const total = points.length;
  if (total <= max) return { points: [...points], total };
  const out: T[] = [];
  const step = (total - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)] as T);
  return { points: out, total };
}

/** Pick the named keys that are present; money stays a decimal string, never `Number()`. */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}
