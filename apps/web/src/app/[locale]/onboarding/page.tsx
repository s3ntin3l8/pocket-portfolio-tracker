import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSessionState } from "@/lib/session-token";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

// Same authConfigured gate as the `(app)` layout — auth is only enforced once
// AUTH_SECRET plus a login method (Authentik's issuer or local password auth) are set,
// so the design-system screens stay viewable in local dev before either is wired.
const authConfigured = Boolean(
  process.env.AUTH_SECRET && (process.env.AUTHENTIK_ISSUER || process.env.AUTH_LOCAL_SECRET),
);

// Onboarding is a sibling of `(app)`, not inside it — full-screen, no AppShell — so
// it needs its own auth gate (the `(app)` layout's redirect doesn't cover this route).
// Every render depends on the session cookie, so this can't be statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (authConfigured) {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const sessionState = await getSessionState(cookieHeader);
    if (!sessionState.isAuthenticated) {
      redirect(`/${locale}`);
    }
  }

  // Onboarding is a sibling of `(app)`, so it inherits neither the AppShell's
  // `<main>` landmark nor its skip link — it brings its own (audit R4-D13).
  const tA = await getTranslations({ locale, namespace: "A11y" });

  return (
    <>
      {/* Skip link: first focusable element; jumps past the intro to <main>. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-card focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {tA("skipToContent")}
      </a>
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <OnboardingFlow />
      </main>
    </>
  );
}
