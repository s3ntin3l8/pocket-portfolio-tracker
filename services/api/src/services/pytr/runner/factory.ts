import { fileURLToPath } from "node:url";
import type { FastifyBaseLogger } from "fastify";
import { PytrRunner } from "./core.js";

let runner: PytrRunner | null = null;

export function getPytrRunner(
  config: {
    PYTR_PYTHON_BIN: string;
    PYTR_WAF_STRATEGY: "awswaf" | "playwright";
    PYTR_ENABLED: boolean;
  },
  log?: FastifyBaseLogger,
): PytrRunner {
  if (!runner) {
    runner = new PytrRunner({
      pythonBin: config.PYTR_PYTHON_BIN,
      wafStrategy: config.PYTR_WAF_STRATEGY,
      enabled: config.PYTR_ENABLED,
      scriptDir: fileURLToPath(new URL("../../../../python", import.meta.url)),
      log,
    });
  }
  return runner;
}
