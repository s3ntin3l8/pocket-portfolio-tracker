import { cookies } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { Landing } from "@/components/landing";

// Locale-based default when no returning-user cookie is set yet — id visitors see the
// domestic figure, everyone else a Euro one (the primary user's home currency).
const DEFAULT_CURRENCY_BY_LOCALE: Record<string, string> = { id: "IDR", en: "EUR" };
const SUPPORTED_DEMO_CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

const localAuthAvailable = Boolean(process.env.AUTH_LOCAL_SECRET);
// Same condition as the (app) layout's session-cookie gate and the /api/backend proxy's
// devToken bypass (see apps/web/src/app/[locale]/(app)/layout.tsx and
// apps/web/src/app/api/backend/[...path]/route.ts) — when DEV_AUTH_TOKEN is active, the
// sign-in forms below are dead ends (Authentik/local auth may not be configured at all).
const devBypass = process.env.NODE_ENV !== "production" && Boolean(process.env.DEV_AUTH_TOKEN);

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cookieStore = await cookies();
  const cookieCurrency = cookieStore.get("display_currency")?.value;
  const currency =
    cookieCurrency && SUPPORTED_DEMO_CURRENCIES.includes(cookieCurrency)
      ? cookieCurrency
      : (DEFAULT_CURRENCY_BY_LOCALE[locale] ?? "EUR");

  return (
    <Landing
      initialCurrency={currency}
      localAuthAvailable={localAuthAvailable}
      devBypass={devBypass}
    />
  );
}
