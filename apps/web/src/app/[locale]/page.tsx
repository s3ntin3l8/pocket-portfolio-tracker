import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { Landing } from "@/components/landing";

// Locale-based default when no returning-user cookie is set yet — id visitors see the
// domestic figure, everyone else a Euro one (the primary user's home currency).
const DEFAULT_CURRENCY_BY_LOCALE: Record<string, string> = { id: "IDR", en: "EUR" };
const SUPPORTED_DEMO_CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

const localAuthAvailable = Boolean(process.env.AUTH_LOCAL_SECRET);
const authentikAvailable = Boolean(process.env.AUTHENTIK_ISSUER);
// Same condition as the (app) layout's session-cookie gate and the /api/backend proxy's
// devToken bypass (see apps/web/src/app/[locale]/(app)/layout.tsx and
// apps/web/src/app/api/backend/[...path]/route.ts) — when DEV_AUTH_TOKEN is active, the
// sign-in forms below are dead ends (Authentik/local auth may not be configured at all).
const devBypass = process.env.NODE_ENV !== "production" && Boolean(process.env.DEV_AUTH_TOKEN);

/**
 * Whether the self-host first-run flow (POST /auth/local/setup) should still be
 * offered — true only while local auth is on and the deployment has zero users yet.
 * Unauthenticated GET, so a direct fetch (no session cookie needed) rather than the
 * server-api client. Fails closed (assume no setup needed) on any error — a broken
 * check should fall back to the ordinary login form, not block it.
 */
async function needsLocalAuthSetup(): Promise<boolean> {
  if (!localAuthAvailable || !process.env.API_URL) return false;
  try {
    const res = await fetch(`${process.env.API_URL}/auth/local/setup-status`, {
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { needsSetup?: boolean };
    return data.needsSetup === true;
  } catch {
    return false;
  }
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cookieStore = await cookies();
  const cookieCurrency = cookieStore.get("display_currency")?.value;
  const currency =
    cookieCurrency && SUPPORTED_DEMO_CURRENCIES.includes(cookieCurrency)
      ? cookieCurrency
      : (DEFAULT_CURRENCY_BY_LOCALE[locale] ?? "EUR");

  const needsSetup = devBypass ? false : await needsLocalAuthSetup();

  return (
    <Landing
      initialCurrency={currency}
      localAuthAvailable={localAuthAvailable}
      authentikAvailable={authentikAvailable}
      devBypass={devBypass}
      needsSetup={needsSetup}
    />
  );
}
