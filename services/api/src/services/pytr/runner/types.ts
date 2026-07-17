import type { ChildProcess } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";
import type { SpawnFn } from "../process.js";

export interface DocDownloadResult {
  buf: Buffer;
  mimeType: string;
}

export interface DownloadDocumentsResult {
  docs: Map<string, DocDownloadResult>;
  failures: { docId: string | null; error: string }[];
}

export interface PytrRunnerOptions {
  pythonBin: string;
  scriptDir: string;
  wafStrategy: "awswaf" | "playwright";
  enabled: boolean;
  spawn?: SpawnFn;
  pairingTimeoutMs?: number;
  exportTimeoutMs?: number;
  log?: FastifyBaseLogger;
}

export type RawTrEvent = Record<string, unknown>;

export interface TrExportSummary {
  cash?: { currency: string; amount: number | string }[] | null;
  positions?: { isin: string; qty: number | string }[] | null;
}

export interface PendingPairing {
  child: ChildProcess;
  cookiesFile: string;
  tmpDir: string;
  stderr: string;
  onInit: { resolve: (processId: string) => void; reject: (e: Error) => void } | null;
  onApproval: { resolve: (sessionData: string) => void; reject: (e: Error) => void } | null;
  settled: { sessionData: string } | { error: Error } | null;
  timer: NodeJS.Timeout;
}
