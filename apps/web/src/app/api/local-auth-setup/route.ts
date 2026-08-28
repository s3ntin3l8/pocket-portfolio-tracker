import { NextResponse, type NextRequest } from "next/server";

/**
 * Same-origin proxy for the ONE unauthenticated local-auth write: POST /auth/local/setup
 * (the first-run "create your admin account" flow, apps/web/src/components/landing.tsx).
 * Unlike app/api/backend/[...path]/route.ts, this never has a session cookie to attach —
 * there is no session yet — so it can't reuse that proxy (which 401s without one). Keeps
 * `API_URL` server-only, same rationale as the backend proxy's own comment.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const apiUrl = process.env.API_URL;
  if (!apiUrl || !process.env.AUTH_LOCAL_SECRET) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  const upstream = await fetch(`${apiUrl.replace(/\/$/, "")}/auth/local/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
