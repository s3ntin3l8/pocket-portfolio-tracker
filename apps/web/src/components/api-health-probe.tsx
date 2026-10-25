"use client";

import { useEffect, useState } from "react";

/**
 * The diagnostic behind the "Can't reach the API" state: what actually answered the
 * API's own health endpoint?
 *
 * The probe goes through the same-origin proxy (`/api/backend/...` — the path the app
 * itself uses), never straight to the API's address, so it sees exactly what the app
 * sees. A foreign service bound to the API's port answers too (127.0.0.1:3000 wins over
 * the API's own *:3000 bind) — but not with our `service` marker, which is what makes
 * the two cases tellable apart.
 *
 * The line is technical on purpose: it names the probe, the status and the responder's
 * identity, so it reads the same in every locale.
 */
export function ApiHealthProbe() {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/backend/health", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.text().catch(() => "");
        if (!live) return;
        setLine(describeProbe(res.status, body));
      })
      .catch(() => {
        if (live) setLine("health: /api/backend/health → no response");
      });
    return () => {
      live = false;
    };
  }, []);

  if (!line) return null;
  return (
    <p role="status" className="mt-2 max-w-sm break-all font-mono text-xs text-muted-foreground">
      {line}
    </p>
  );
}

/** The probe's verdict: the HTTP status and the responder's identity (if it gave one). */
function describeProbe(status: number, body: string): string {
  const base = `health: /api/backend/health → HTTP ${status}`;
  const service = serviceOf(body);
  if (!service) return base;
  // Another service answered on the API's address — the port-shadowing case.
  return service === "pocket-api"
    ? `${base}, service=${service}`
    : `${base}, service=${service} (expected pocket-api)`;
}

/** The `service` marker of a health payload, if the body is one. */
function serviceOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const service = (parsed as { service?: unknown }).service;
      if (typeof service === "string" && service) return service;
    }
  } catch {
    // Not a JSON health payload (e.g. a foreign server's HTML error page).
  }
  return null;
}
