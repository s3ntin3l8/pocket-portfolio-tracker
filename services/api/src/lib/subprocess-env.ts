// Environment handed to spawned helpers (pytr, Playwright): an allow-list, never the whole
// `process.env` — a compromised or buggy child must not be able to read the API's own
// secrets (DB URL, encryption key, auth secret, storage keys, …).
const ALLOWED_EXACT = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "PYTHONUNBUFFERED",
  "DISPLAY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "PLAYWRIGHT_BROWSERS_PATH",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
]);

/** Allow-listed parent variables, then `extraEnv` (which overrides allow-listed keys). */
export function buildSubprocessEnv(
  extraEnv: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (ALLOWED_EXACT.has(k) || k.startsWith("LC_")) out[k] = v;
  }
  return { ...out, ...extraEnv };
}
