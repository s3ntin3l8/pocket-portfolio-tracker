import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { runProcess, readLines, safeRm, type SpawnFn } from "../process.js";
import { PytrApprovalError, PytrAuthError, PytrError, PytrUnavailableError } from "../errors.js";
import type {
  DocDownloadResult,
  DownloadDocumentsResult,
  PendingPairing,
  PytrRunnerOptions,
  RawTrEvent,
  TrExportSummary,
} from "./types.js";

export class PytrRunner {
  private readonly opts: Required<Omit<PytrRunnerOptions, "spawn" | "log">> & { spawn: SpawnFn };
  private readonly log: FastifyBaseLogger | null;
  private readonly pending = new Map<string, PendingPairing>();

  constructor(options: PytrRunnerOptions) {
    this.log = options.log ?? null;
    this.opts = {
      pythonBin: options.pythonBin,
      scriptDir: options.scriptDir,
      wafStrategy: options.wafStrategy,
      enabled: options.enabled,
      spawn: options.spawn ?? nodeSpawn,
      pairingTimeoutMs: options.pairingTimeoutMs ?? 210_000,
      exportTimeoutMs: options.exportTimeoutMs ?? 300_000,
    };
  }

  get isEnabled(): boolean {
    return this.opts.enabled;
  }

  private script(name: string): string {
    return join(this.opts.scriptDir, name);
  }

  async startPairing(
    userId: string,
    input: { phone: string; pin: string; wafToken?: string },
  ): Promise<{ processId: string }> {
    if (!this.opts.enabled) throw new PytrUnavailableError();
    this.cancelPairing(userId);

    const tmpDir = await mkdtemp(join(tmpdir(), "pytr-pair-"));
    const cookiesFile = join(tmpDir, "cookies.txt");

    let child: ChildProcess;
    try {
      child = this.opts.spawn(
        this.opts.pythonBin,
        [
          this.script("tr_login.py"),
          "pair",
          "--cookies-file",
          cookiesFile,
          "--waf-strategy",
          input.wafToken ? "token" : this.opts.wafStrategy,
        ],
        {
          env: {
            ...process.env,
            TR_PHONE: input.phone,
            TR_PIN: input.pin,
            ...(input.wafToken ? { TR_WAF_TOKEN: input.wafToken } : {}),
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (err) {
      this.log?.error({ err }, "pytr spawn failed");
      await safeRm(tmpDir, this.log);
      throw new PytrUnavailableError(err instanceof Error ? err.message : "failed to spawn python");
    }
    this.log?.info(
      {
        userId,
        pythonBin: this.opts.pythonBin,
        wafStrategy: input.wafToken ? "token" : this.opts.wafStrategy,
      },
      "pytr pairing spawned",
    );

    return new Promise<{ processId: string }>((resolve, reject) => {
      const entry: PendingPairing = {
        child,
        cookiesFile,
        tmpDir,
        stderr: "",
        onInit: {
          resolve: (processId) => resolve({ processId }),
          reject,
        },
        onApproval: null,
        settled: null,
        timer: setTimeout(() => {
          this.failPairing(userId, new PytrError("pairing timed out"));
        }, this.opts.pairingTimeoutMs),
      };
      this.pending.set(userId, entry);

      readLines(child, (line) => this.onPairLine(userId, line));
      child.stderr?.on("data", (d: Buffer) => {
        entry.stderr += d.toString();
      });
      child.on("error", (err) => this.failPairing(userId, err));
      child.on("exit", (code) => this.onPairExit(userId, code));
    });
  }

  private onPairLine(userId: string, line: string): void {
    const entry = this.pending.get(userId);
    if (!entry?.onInit) return;
    let parsed: { processId?: unknown; status?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed.processId === "string" && parsed.processId) {
      const { resolve } = entry.onInit;
      entry.onInit = null;
      resolve(parsed.processId);
    }
  }

  private onPairExit(userId: string, code: number | null): void {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    const finalize = async () => {
      try {
        if (code === 0) {
          this.log?.info({ userId }, "pytr pairing approved");
          const sessionData = await readFile(entry.cookiesFile, "utf8");
          if (entry.onApproval) {
            entry.onApproval.resolve(sessionData);
            this.pending.delete(userId);
          } else {
            entry.settled = { sessionData };
          }
        } else {
          this.log?.warn(
            { userId, code, stderr: entry.stderr.trim() },
            "pytr pairing exited nonzero",
          );
          const msg = entry.stderr.trim() || `pytr login exited with code ${code}`;
          const err = code === 3 ? new PytrApprovalError(msg) : new PytrError(msg);
          entry.onInit?.reject(err);
          entry.onInit = null;
          if (entry.onApproval) {
            entry.onApproval.reject(err);
            this.pending.delete(userId);
          } else {
            entry.settled = { error: err };
          }
        }
      } catch (err) {
        const e = err instanceof Error ? err : new PytrError("failed to read session");
        entry.onInit?.reject(e);
        entry.onInit = null;
        if (entry.onApproval) {
          entry.onApproval.reject(e);
          this.pending.delete(userId);
        } else {
          entry.settled = { error: e };
        }
      } finally {
        await safeRm(entry.tmpDir, this.log, { userId });
      }
    };
    finalize().catch((err) => this.log?.warn({ userId, err }, "pytr pairing finalize failed"));
  }

  private failPairing(userId: string, err: Error): void {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.onInit?.reject(err);
    entry.onApproval?.reject(err);
    entry.onInit = null;
    entry.onApproval = null;
    try {
      entry.child.kill("SIGKILL");
    } catch (killErr) {
      this.log?.warn({ userId, err: killErr }, "pytr kill failed");
    }
    this.pending.delete(userId);
    void safeRm(entry.tmpDir, this.log, { userId });
  }

  hasPendingPairing(userId: string): boolean {
    return this.pending.has(userId);
  }

  awaitApproval(userId: string): Promise<string> {
    const entry = this.pending.get(userId);
    if (!entry) {
      return Promise.reject(new PytrError("no pairing in progress"));
    }
    if (entry.settled) {
      const settled = entry.settled;
      this.pending.delete(userId);
      return "sessionData" in settled
        ? Promise.resolve(settled.sessionData)
        : Promise.reject(settled.error);
    }
    return new Promise<string>((resolve, reject) => {
      entry.onApproval = { resolve, reject };
    });
  }

  cancelPairing(userId: string): void {
    const entry = this.pending.get(userId);
    if (!entry) return;
    clearTimeout(entry.timer);
    try {
      entry.child.kill("SIGKILL");
    } catch (killErr) {
      this.log?.warn({ userId, err: killErr }, "pytr kill failed");
    }
    this.pending.delete(userId);
    void safeRm(entry.tmpDir, this.log, { userId });
  }

  async export(input: {
    phone: string;
    pin: string;
    sessionData: string;
  }): Promise<{ events: RawTrEvent[]; sessionData: string; summary?: TrExportSummary }> {
    if (!this.opts.enabled) throw new PytrUnavailableError();
    this.log?.info({ exportTimeoutMs: this.opts.exportTimeoutMs }, "pytr export started");
    const tmpDir = await mkdtemp(join(tmpdir(), "pytr-export-"));
    const cookiesFile = join(tmpDir, "cookies.txt");
    try {
      await writeFile(cookiesFile, input.sessionData, "utf8");
      const { code, stdout, stderr } = await this.run(
        this.script("tr_export.py"),
        ["--cookies-file", cookiesFile],
        this.opts.exportTimeoutMs,
        { TR_PHONE: input.phone, TR_PIN: input.pin },
      );
      if (code === 2) {
        this.log?.warn({}, "pytr session expired");
        throw new PytrAuthError(stderr.trim() || undefined);
      }
      if (code !== 0) {
        this.log?.error({ code, stderr: stderr.trim() }, "pytr export failed");
        throw new PytrError(stderr.trim() || `pytr export exited with code ${code}`);
      }
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RawTrEvent | { __summary__: TrExportSummary });
      let summary: TrExportSummary | undefined;
      const events: RawTrEvent[] = [];
      for (const line of lines) {
        if (line && typeof line === "object" && "__summary__" in line) {
          summary = (line as { __summary__: TrExportSummary }).__summary__;
        } else {
          events.push(line as RawTrEvent);
        }
      }
      const sessionData = await readFile(cookiesFile, "utf8").catch(() => input.sessionData);
      return { events, sessionData, summary };
    } finally {
      await safeRm(tmpDir, this.log);
    }
  }

  async downloadDocuments(
    session: { phone: string; pin: string; sessionData: string },
    pairs: { eventId: string; docId: string }[],
  ): Promise<DownloadDocumentsResult> {
    if (!this.opts.enabled) throw new PytrUnavailableError();
    if (pairs.length === 0) return { docs: new Map(), failures: [] };

    const tmpDir = await mkdtemp(join(tmpdir(), "pytr-docs-"));
    const cookiesFile = join(tmpDir, "cookies.txt");
    const outDir = join(tmpDir, "out");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(outDir, { recursive: true });

    try {
      await writeFile(cookiesFile, session.sessionData, "utf8");

      const { code, stdout, stderr } = await this.runWithStdin(
        this.script("tr_documents.py"),
        ["--cookies-file", cookiesFile, "--out", outDir],
        this.opts.exportTimeoutMs,
        { TR_PHONE: session.phone, TR_PIN: session.pin },
        pairs.map((p) => JSON.stringify(p)).join("\n") + "\n",
      );

      if (code === 2) {
        this.log?.warn({}, "pytr session expired during document download");
        throw new PytrAuthError(stderr.trim() || undefined);
      }
      if (code !== 0) {
        this.log?.error({ code, stderr: stderr.trim() }, "pytr documents download failed");
        throw new PytrError(stderr.trim() || `tr_documents.py exited with code ${code}`);
      }

      const docs = new Map<string, DocDownloadResult>();
      const failures: { docId: string | null; error: string }[] = [];
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        let parsed: {
          docId?: string;
          file?: string;
          mimeType?: string;
          ok?: boolean;
          error?: string;
        };
        try {
          parsed = JSON.parse(line);
        } catch {
          this.log?.warn({ line }, "tr_documents: unparseable stdout line");
          failures.push({ docId: null, error: `unparseable line: ${line.slice(0, 100)}` });
          continue;
        }
        if (!parsed.ok || !parsed.docId || !parsed.file) {
          const reason = parsed.error ?? (parsed.docId ? "missing file field" : "missing docId");
          this.log?.warn({ docId: parsed.docId, error: reason }, "tr_documents: per-doc failure");
          failures.push({ docId: parsed.docId ?? null, error: reason });
          continue;
        }
        try {
          const buf = await readFile(join(outDir, parsed.file));
          docs.set(parsed.docId, { buf, mimeType: parsed.mimeType ?? "application/pdf" });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.log?.warn({ docId: parsed.docId, err }, "tr_documents: failed to read output file");
          failures.push({ docId: parsed.docId, error: `file read failed: ${reason}` });
        }
      }

      this.log?.debug(
        { requested: pairs.length, downloaded: docs.size, failed: failures.length },
        "pytr documents fetched",
      );
      return { docs, failures };
    } finally {
      await safeRm(tmpDir, this.log);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.opts.enabled) return false;
    try {
      const { code } = await this.run("-c", ["import pytr"], 10_000);
      return code === 0;
    } catch (err) {
      this.log?.warn({ pythonBin: this.opts.pythonBin, err }, "pytr unavailable");
      return false;
    }
  }

  private get procCfg() {
    return { spawn: this.opts.spawn, pythonBin: this.opts.pythonBin, log: this.log };
  }

  private run(
    first: string,
    args: string[],
    timeoutMs: number,
    extraEnv: Record<string, string> = {},
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return runProcess(this.procCfg, first, args, timeoutMs, extraEnv, null);
  }

  private runWithStdin(
    first: string,
    args: string[],
    timeoutMs: number,
    extraEnv: Record<string, string> = {},
    stdinData: string | null = null,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return runProcess(this.procCfg, first, args, timeoutMs, extraEnv, stdinData);
  }
}
