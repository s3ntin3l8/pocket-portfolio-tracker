#!/usr/bin/env node
import { parseArgs } from "node:util";

/**
 * Run the analysis-integrity invariants against a running API with your own credential and
 * print what breaks (see docs/integrity.md).
 *
 *   POCKET_TOKEN=pt_... npm run integrity                       # API at http://localhost:3000
 *   POCKET_API_URL=https://api.example.com POCKET_TOKEN=pt_... npm run integrity
 *   npm run integrity -- --json                                  # machine-readable
 *
 * A read-scoped personal access token is enough: the check only issues GETs. Findings contain
 * amounts, so keep the output local — don't paste it into issues or PRs.
 *
 * Exit code: 0 = no findings, 1 = findings, 2 = the check itself could not run.
 */

const { values } = parseArgs({ options: { json: { type: "boolean", default: false } } });

const base = (process.env.POCKET_API_URL ?? process.env.API_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);
const token = process.env.POCKET_TOKEN ?? process.env.DEV_AUTH_TOKEN;
if (!token) {
  console.error(
    "Set POCKET_TOKEN to a personal access token (Settings → API tokens; read scope is enough).",
  );
  process.exit(2);
}

let res;
try {
  res = await fetch(`${base}/me/integrity`, {
    headers: { authorization: `Bearer ${token}` },
    // Valuing every portfolio can take a while on a big account; a hung connection must not.
    signal: AbortSignal.timeout(120_000),
  });
} catch (err) {
  console.error(`Could not reach ${base}: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}
if (!res.ok) {
  console.error(`GET /me/integrity -> ${res.status}: ${await res.text()}`);
  process.exit(2);
}
let report;
try {
  report = await res.json();
} catch {
  console.error(
    `GET /me/integrity -> ${res.status} but the body is not JSON (proxy or error page?).`,
  );
  process.exit(2);
}
// Exit 1 means "findings"; a malformed report must not be mistaken for one.
if (!Array.isArray(report?.findings) || !Array.isArray(report?.rulesRun)) {
  console.error("GET /me/integrity returned an unexpected shape (no findings/rulesRun arrays).");
  process.exit(2);
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { findings, rulesRun, portfolioCount, checkedAt } = report;
  console.log(
    `Checked ${portfolioCount} portfolio(s) against ${rulesRun.length} rules at ${checkedAt}.`,
  );
  if (findings.length === 0) {
    console.log("No findings: every invariant holds on this data.");
  } else {
    console.log(`\n${findings.length} finding(s):\n`);
    for (const f of findings) {
      console.log(`  ${f.rule}  [${f.scope}]`);
      console.log(`    ${f.message}`);
      console.log(
        `    expected ${f.expected}   actual ${f.actual}   diff ${f.diff} (tol ${f.tolerance})\n`,
      );
    }
  }
}
process.exit(report.findings.length > 0 ? 1 : 0);
