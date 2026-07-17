# Web Component Decompositions — Phase 7 Follow-up

## Summary

Decompose 14 remaining web components >400 lines into focused sub-module files (hooks, sub-components, single-table files), following the Phase 7 API/package file decomposition pattern.

## Approach

Three extraction patterns applied in parallel based on each file's structure:

1. **Hook extraction** — move state declarations + handlers into a co-located `hooks.ts` or `use-*.ts`
2. **Sub-component extraction** — move inline sub-components into their own files under a directory named after the parent
3. **Multi-table file splitting** — split files exporting multiple table components into one file per table

## Files and Splits

### Group A: Hook extractions

| File                            | Lines | Extractions                                    |
| ------------------------------- | ----- | ---------------------------------------------- |
| `add-transaction-form.tsx`      | 549   | `add-transaction-form/use-transaction-form.ts` |
| `savings/rebalance-dialog.tsx`  | 436   | `savings/use-rebalance.ts`                     |
| `corporate-actions-manager.tsx` | 429   | `corporate-actions/use-corporate-actions.ts`   |

**use-transaction-form.ts** extracts:

- 28 `useState` declarations + derived booleans (`isAcquisition`, `showQuantity`, `hasInstrument`, `isGold`)
- `runSearch`, `prefillFrom`, `resolveInstrumentId`, `submit` handlers
- `typeGroups` const, gold source `useEffect`
- Exports: `useTransactionForm(props)` returning all state + handlers

**use-rebalance.ts** extracts:

- `fetchTargets`, `fetchTradeRecommendations`, `handleSave`
- `handleOpenChange`, `handleToggleSales`, `updateRow`
- All state vars (`rows`, `loading`, `saving`, `error`, `includeSales`, etc.)
- Derived: `total`, `sumOk`, `labelByKey`, `splitByKey`, `toggleDisabled`
- Exports: `useRebalance(props)` returning state + handlers

**use-corporate-actions.ts** extracts:

- `items` state, `editingId`, `confirmId`, `busy`
- Inline edit handlers, delete confirmation, add-form state
- `CA_COLS` column def, table sort
- Exports: `useCorporateActions(props)` returning state + handlers

### Group B: Sub-component splits

| File                              | Lines | Extractions                                                                                  |
| --------------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `trades-table.tsx`                | 476   | `trades-table/{FilterBar,DesktopRow,MobileRow,LegRow}.tsx`                                   |
| `admin-vision-providers-form.tsx` | 469   | `admin-vision-providers/{VisionCredentialCell}.tsx`                                          |
| `admin-storage-form.tsx`          | 467   | `admin-storage/{SecretCell,SourceBadge,Field}.tsx` + shared `admin/use-credential-dialog.ts` |
| `import-review/table.tsx`         | 462   | `import-review/{DraftRow,ReviewGroupHeader,ReviewActions}.tsx`                               |
| `savings/rebalance-dialog.tsx`    | 436   | `savings/trade-actions-section.tsx`                                                          |

**trades-table:** constants.ts already exists. Extract 4 sub-components:

- `FilterBar` — status filter chips + search input with clear button
- `DesktopRow` — full table row with inline leg expansion, link to instrument
- `MobileRow` — compact card with instrument logo, P&L, status badge
- `LegRow` — expanded leg detail within a desktop row (acquisition date → sell date, holding days, cost/proceeds/gain)
- Leaves: `TradesTable` as orchestrator (~80 lines)

**admin-vision-providers:**

- `VisionCredentialCell` — the credential state display + edit dialog + clear button
- Leaves: `AdminVisionProvidersForm` (~250 lines)

**admin-storage:**

- `SecretCell` — secret key dialog (set/rotate/clear with show/hide toggle)
- `SourceBadge` — small "db"/"env" badge used on each field row
- `Field` — labeled text input with optional `SourceBadge`
- Leaves: `AdminStorageForm` (~280 lines)

**import-review/table.tsx:**

- `DraftRow` — single row with checkbox, type icon, instrument/amount/confidence, duplicate badge
- `ReviewGroupHeader` — sticky column header for batch-group name
- `ReviewActions` — "Select all" / "Remove selected" action bar
- Leaves: main table component (~100 lines)

**savings/trade-actions-section.tsx:**

- Already a well-separated sub-component in `rebalance-dialog.tsx`; extract to own file and import

### Group C: Multi-table splits

| File                     | Lines | Extractions                                                           |
| ------------------------ | ----- | --------------------------------------------------------------------- |
| `tax/tax-tables.tsx`     | 466   | `tax/{dividends-table,id-dividends-table,year-table}.tsx`             |
| `tax/disposal-table.tsx` | 415   | `tax/{use-expanded-rows,disposals-table-de,sales-table-id}.ts`/`.tsx` |

**tax-tables.tsx** contains `DividendsTable`, `IDDividendsTable`, and `YearTable` — three independent table components with separate column definitions. Each becomes its own file; the original becomes a re-export barrel.

**disposal-table.tsx** contains DE `DisposalsTable` and ID `SalesTable` (for Indonesian PPh final tax). The shared `useExpandedRows` hook extracts to `use-expanded-rows.ts`; each table gets its own file.

### Group D: Borderline (optional — same approach, lower priority)

| File                             | Lines | Extractions                                          |
| -------------------------------- | ----- | ---------------------------------------------------- |
| `add-transaction-menu.tsx`       | 432   | `loadHarvestPrefill` + `MethodCard` + `TONES`        |
| `import-history.tsx`             | 456   | Render sections (already has 5 imported sub-modules) |
| `import-flow/step-views.tsx`     | 427   | Split per-step views                                 |
| `import-flow/use-import-flow.ts` | 528   | Extract `handleFiles` parse-flow logic               |

### Shared hooks

**`admin/use-credential-dialog.ts`:**

- Shared by `VisionCredentialCell` and `SecretCell` — both manage a dialog with set/clear lifecycle
- Exports: `useCredentialDialog()` returning `{ dialogOpen, apiKey, showKey, setApiKey, setShowKey, handleDialogChange, saveState/clearState, handleSet, handleClear }`
- Each caller wires its own API call (vision provider vs S3 secret)

**`tax/use-expanded-rows.ts`:**

- Shared by `disposal-table.tsx` and `tax-tables.tsx` (latter currently has inline expansion)
- Exports: `useExpandedRows()` returning `{ expanded, toggle }`

## Non-goals

- No behavior changes
- No CSS/tailwind refactoring
- No API client changes
- No new type definitions (move existing ones as-is)
- No conversion between component patterns (keep `function` vs `const` as-is per file)

## Test plan

- [ ] `npm run typecheck` — clean
- [ ] `npm test` — all pass
- [ ] Each extracted hook unit-testable in isolation (verify with a simple render test if applicable)
