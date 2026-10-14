/**
 * Checked state for a select-all checkbox: `true` when every row is selected,
 * `"indeterminate"` when only some are, `false` when none are (or there are no rows).
 */
export function selectAllState(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  if (ids.length === 0) return false;
  let n = 0;
  for (const id of ids) if (selected.has(id)) n++;
  if (n === 0) return false;
  return n === ids.length ? true : "indeterminate";
}
