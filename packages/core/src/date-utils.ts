export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toMonthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
