import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { SCOPE_HEADER, SCOPE_PARAM, parseScopeParam } from "./lib/portfolio-selection";

const intlMiddleware = createMiddleware(routing);

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function hostName(value: string): string | null {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function configuredAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const entry of splitCsv(process.env.WEB_ALLOWED_HOSTS)) {
    const host = hostName(entry);
    if (host) hosts.add(host);
  }
  const authHost = process.env.AUTH_URL ? hostName(process.env.AUTH_URL) : null;
  if (authHost) hosts.add(authHost);
  return hosts;
}

function isLocalHost(host: string): boolean {
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1"
  );
}

/**
 * Validates the SAME header Auth.js's `trustHost: true` actually derives its callback/
 * cookie origin from. Auth.js reads `x-forwarded-host` when present (falling back to
 * `host`), so checking only `host` here would let a spoofed `x-forwarded-host` steer
 * Auth.js's origin while this guard still saw (and approved) the real `Host` header.
 * Depends on Traefik overwriting/stripping any client-supplied `x-forwarded-host` rather
 * than passing it through — see the deployment's Traefik config.
 */
export function isAllowedHost(headers: Pick<Headers, "get">): boolean {
  const hostHeader = headers.get("x-forwarded-host") ?? headers.get("host");
  const host = hostHeader ? hostName(hostHeader) : null;
  if (!host) return false;
  if (configuredAllowedHosts().has(host)) return true;
  return process.env.NODE_ENV !== "production" && isLocalHost(host);
}

export function bypassI18n(pathname: string): boolean {
  return (
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/backend" ||
    pathname.startsWith("/api/backend/")
  );
}

export default function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers)) {
    return new NextResponse("Misdirected Request", { status: 421 });
  }
  if (bypassI18n(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  return intlMiddleware(withScopeHeader(request));
}

/**
 * Surface a valid `?scope=` as a request header for RSC loaders (they can't see the URL).
 * A client-supplied header of the same name is always dropped first.
 */
export function withScopeHeader(request: NextRequest): NextRequest {
  const param = request.nextUrl.searchParams.get(SCOPE_PARAM);
  const valid = parseScopeParam(param) !== null;
  if (!valid && !request.headers.has(SCOPE_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(SCOPE_HEADER);
  if (valid && param) headers.set(SCOPE_HEADER, param);
  return new NextRequest(request, { headers });
}

export const config = {
  // Match app pathnames plus Auth.js API routes and the same-origin backend proxy
  // (app/api/backend/[...path]) so the host guard covers all of them.
  matcher: ["/api/auth/:path*", "/api/backend/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
