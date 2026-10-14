// Barrel re‑export: sub‑modules live in runner/{types,core,factory}.ts.
// Existing `from "./runner.js"` imports keep working.
export {
  PytrApprovalError,
  PytrAuthError,
  PytrCodeInvalidError,
  PytrCodeRequiredError,
  PytrError,
  PytrUnavailableError,
} from "./errors.js";
export type { SpawnFn } from "./process.js";
export type {
  DocDownloadResult,
  DownloadDocumentsResult,
  PytrRunnerOptions,
  RawTrEvent,
  TrExportSummary,
} from "./runner/types.js";
export { PytrRunner } from "./runner/core.js";
export { getPytrRunner } from "./runner/factory.js";
