"use client";

import { SessionProvider } from "next-auth/react";
import { usePageVisible } from "@/lib/use-interval";

/**
 * Client wrapper so `useSession()` works in client components below the tree.
 *
 * `refetchInterval={60}` polls `/api/auth/session` every 60s. Crucially that route
 * handler runs the `jwt` callback in a cookie-WRITABLE context, so it rotates the
 * short-lived (~5 min) Authentik access token and PERSISTS the rotation back to the
 * session cookie *before* it expires. That keeps both server-component reads — which
 * can't write cookies, so they'd otherwise re-spend a consumed refresh token every
 * request — and the client `useSession()` token continuously fresh. Without it the
 * session silently dies ~5 min after login. `refetchOnWindowFocus` additionally
 * refreshes when returning to a backgrounded tab.
 *
 * The interval is switched off (`0`) while the tab is hidden — a backgrounded PWA has no
 * need to hit the API every minute — and `refetchOnWindowFocus` (plus the interval
 * re-arming on `visibilitychange`) rotates the token as soon as the user is back.
 */
export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const visible = usePageVisible();
  return (
    <SessionProvider refetchInterval={visible ? 60 : 0} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  );
}
