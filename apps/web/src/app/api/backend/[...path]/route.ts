import { NextResponse, type NextRequest } from "next/server";
import { accessTokenFromCookieHeader } from "@/lib/session-token";

/**
 * Same-origin proxy to the Fastify API: the browser talks only to this route (relative
 * `/api/backend/*`, via the api-client's `baseUrl`), never holding the Authentik access
 * token itself. The token lives in the httpOnly Auth.js session cookie and is attached
 * here, server-side, on every request — this is the whole point of the re-architecture
 * (see the security-hardening plan, Part B): a future XSS or compromised dependency in
 * the browser can no longer exfiltrate a usable API bearer.
 *
 * `API_URL` is server-only (never NEXT_PUBLIC_*) and points at the API's internal address
 * (e.g. `http://api:3000` inside the Docker network) — the Fastify API needs no public
 * Traefik route at all once this is the only path to it.
 */

// Never cache a proxy response — every request must re-check the live session/backend.
export const dynamic = "force-dynamic";

// Headers that must never be forwarded verbatim between hops (hop-by-hop / would corrupt
// the re-wrapped response, or must be recomputed rather than copied).
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  // Ignore any client-sent Authorization — this route injects its own from the session.
  "authorization",
  "cookie",
]);
const STRIP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

function apiBaseUrl(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error("API_URL is not configured");
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** The real client IP, resolved once at the edge (Traefik) — see plugins/env.ts's
 *  TRUSTED_PROXY_CIDRS on the API side, which trusts this proxy's own forwarded value. */
function resolvedClientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return null;
  // Take the first hop only: Traefik is the sole ingress and overwrites/sets this header
  // fresh (see the deployment's Traefik config), so forwarding it verbatim would be fine
  // in practice, but pinning to the first value keeps this proxy's own outgoing header
  // unambiguous regardless of upstream configuration drift.
  return xff.split(",")[0]?.trim() || null;
}

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const accessToken = await accessTokenFromCookieHeader(request.headers.get("cookie") ?? "");
  if (!accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const search = request.nextUrl.search;
  const upstreamUrl = `${apiBaseUrl()}/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set("authorization", `Bearer ${accessToken}`);
  const clientIp = resolvedClientIp(request);
  if (clientIp) headers.set("x-forwarded-for", clientIp);

  // GET/HEAD never carry a body; other methods may or may not (e.g. a bodyless DELETE) —
  // check the actual stream rather than assuming by method name.
  const hasBody = request.body !== null && request.method !== "GET" && request.method !== "HEAD";
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    // Multipart/CSV imports stream real request bodies through this proxy — buffering
    // them (e.g. via request.formData()) would defeat streaming and double the memory
    // footprint for large files. duplex:"half" is required by undici/fetch whenever a
    // body is attached to a streamed request.
    body: hasBody ? request.body : undefined,
    // @ts-expect-error -- `duplex` isn't in the DOM RequestInit type yet, but Node's
    // fetch (undici) requires it for a streamed body.
    duplex: hasBody ? "half" : undefined,
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamRes.headers) {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  }

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
