"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertTriangle, Ban } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";

/**
 * Auth.js `pages.error` target. A failed OAuth callback (the classic one: a single-use
 * Authentik authorization `code` that was already consumed or whose PKCE verifier no
 * longer matches — stale/overlapping login tabs, a prefetched callback link) otherwise
 * dead-ends on Auth.js's generic 500 error page, and the only escape is clearing cookies
 * or an incognito window. Instead we bounce straight back into a *fresh* sign-in, which
 * mints new state/PKCE/nonce cookies and — since the Authentik session already exists —
 * round-trips silently to the dashboard. The stale-code trap self-heals.
 *
 * A recoverable error auto-retries exactly once per RETRY_WINDOW; if the retry lands back
 * here inside that window the code-exchange is genuinely failing (not just a stale code),
 * so we stop the redirect loop and show a manual "Try again" instead. `AccessDenied`
 * (the user declined the Authentik consent) is never auto-retried — bouncing them
 * straight back to the consent screen would be hostile.
 */
const RETRY_KEY = "auth-callback-retry-at";
const RETRY_WINDOW_MS = 30_000;

// Auth.js maps a failed authorization-code exchange (CallbackRouteError) to these codes.
// Anything not explicitly non-recoverable is treated as a stale-code case worth one retry.
const NON_RECOVERABLE = new Set(["AccessDenied", "Verification"]);

export function AuthErrorRecovery({
  authentikAvailable = true,
}: {
  /** False when AUTHENTIK_ISSUER is unset — this page is Auth.js's `pages.error`
   *  target, reached only from a failed OAuth callback, so in the ordinary case
   *  Authentik is by definition configured. The exception: a stale error-page cookie
   *  from a PRIOR Authentik session outliving AUTHENTIK_ISSUER being disabled since
   *  (e.g. toggling it off for local dev — see auth.ts's own `authentikAvailable`
   *  comment). `signIn("authentik")` would then 404/land on Auth.js's bare,
   *  provider-less /api/auth/signin page — route back to the landing page instead. */
  authentikAvailable?: boolean;
}) {
  const t = useTranslations("AuthError");
  const router = useRouter();
  const error = useSearchParams().get("error") ?? "";
  // Decide "retrying" (bounce to Authentik) vs "manual" (show a button) during render,
  // not in an effect. Recoverable + not-just-retried → retry; a retry inside the window
  // means the exchange is really failing, so stop the redirect loop. Guarded for SSR
  // (no sessionStorage there) — falls back to the optimistic "retrying" view.
  const [phase] = useState<"retrying" | "manual">(() => {
    if (NON_RECOVERABLE.has(error)) return "manual";
    if (typeof window === "undefined") return "retrying";
    const last = Number(sessionStorage.getItem(RETRY_KEY) ?? "0");
    return Date.now() - last < RETRY_WINDOW_MS ? "manual" : "retrying";
  });
  const startSignIn = () => {
    if (authentikAvailable) {
      void signIn("authentik", { callbackUrl: "/holdings" });
    } else {
      router.push("/");
    }
  };

  // Guard the auto-retry against React StrictMode's double-invoked effects (dev) so we
  // don't fire signIn twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current || phase !== "retrying") return;
    started.current = true;
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    startSignIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "retrying") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-[20px] bg-primary/10 text-primary">
          <Spinner size="xl" />
        </span>
        <h1 className="text-balance text-2xl font-extrabold tracking-tight">{t("retrying")}</h1>
      </div>
    );
  }

  const denied = error === "AccessDenied";
  return (
    <ErrorState
      icon={denied ? Ban : AlertTriangle}
      tone={denied ? "neutral" : "warn"}
      title={denied ? t("deniedTitle") : t("title")}
      body={denied ? t("deniedBody") : t("body")}
      primary={
        <Button
          onClick={() => {
            sessionStorage.removeItem(RETRY_KEY);
            startSignIn();
          }}
        >
          {t("retry")}
        </Button>
      }
    />
  );
}
