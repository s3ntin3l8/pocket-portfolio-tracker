"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { signIn } from "next-auth/react";
import { AlertCircle, Wallet, Shield, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";

// Representative "portfolio glance" amount per demo currency — keeps the figure realistic
// per currency rather than converting one hardcoded number. Same +18.2% delta throughout;
// only its punctuation/percent formatting follows locale.
const DEMO_AMOUNT_BY_CURRENCY: Record<string, number> = {
  IDR: 40_650_000,
  EUR: 24_180,
  USD: 26_400,
  SGD: 35_600,
};
const DEMO_GAIN = 0.182;

const MIN_PASSWORD_LENGTH = 8;

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle className="size-4 shrink-0" />
      {children}
    </div>
  );
}

// Pocket "1A — Split Hero" sign-in (the chosen login concept). Brand panel + auth panel;
// stacks to a compact brand band above the form on mobile. Authentik OIDC is the primary
// auth; when localAuthAvailable is true, the email/password form uses a credentials-
// based login against the API instead of routing through Authentik.
export function Landing({
  initialCurrency = "IDR",
  localAuthAvailable = false,
  authentikAvailable = true,
  devBypass = false,
  needsSetup = false,
}: {
  initialCurrency?: string;
  localAuthAvailable?: boolean;
  /** Whether AUTHENTIK_ISSUER is actually configured — gates the SSO button (and, via
   *  it, startSso) so it's never offered as a dead end when it isn't. Defaults true to
   *  preserve today's OIDC-is-the-default behavior for callers that don't pass it. */
  authentikAvailable?: boolean;
  /** DEV_AUTH_TOKEN is set and NODE_ENV isn't "production" — Authentik/local auth may
   *  not be configured at all, so the sign-in forms above would be dead ends. Show a
   *  plain entry link instead (see apps/web/src/app/[locale]/(app)/layout.tsx, which
   *  stands its session-cookie gate down under the same condition). */
  devBypass?: boolean;
  /** True only while local auth is on and the deployment has zero users yet (GET
   *  /auth/local/setup-status). Swaps the sign-in form for a one-time "create your
   *  admin account" form — the self-host bootstrap in place of the destructive
   *  `make seed-demo-login` script. */
  needsSetup?: boolean;
}) {
  const t = useTranslations("Landing");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState(false);

  const demoCurrency =
    DEMO_AMOUNT_BY_CURRENCY[initialCurrency] !== undefined ? initialCurrency : "IDR";
  const demoAmount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: demoCurrency,
    maximumFractionDigits: 0,
  }).format(DEMO_AMOUNT_BY_CURRENCY[demoCurrency]);
  const demoGain = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(DEMO_GAIN);

  const startSso = () => {
    setBusy(true);
    void signIn("authentik", { callbackUrl: "/holdings" });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError(false);
    setBusy(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    if (localAuthAvailable) {
      // redirect:false so a wrong password surfaces inline instead of navigating to
      // Auth.js's bare, unstyled /api/auth/signin?error=CredentialsSignin page — there's
      // no pages.signIn configured (only pages.error, for the OAuth callback path).
      const result = await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirect: false,
      });
      if (result?.error) {
        setLoginError(true);
        setBusy(false);
        return;
      }
      router.push("/holdings");
    } else {
      void signIn("authentik", { callbackUrl: "/holdings" });
    }
  };

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      {/* Brand / hero panel */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-[linear-gradient(150deg,#11211a_0%,#12271c_46%,#0e3123_100%)] p-8 text-white md:w-[54%] md:p-12 dark:bg-[linear-gradient(150deg,#0c1a13_0%,#0f2419_46%,#0b2e21_100%)]">
        {/* ambient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(14,159,110,0.32),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-[radial-gradient(circle,rgba(56,225,164,0.10),transparent_70%)]"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-primary">
            <Wallet className="size-[18px]" strokeWidth={2} />
          </span>
          <span className="text-lg font-extrabold tracking-tight">Pocket</span>
        </div>

        <div className="relative mt-10 space-y-6 md:mt-auto">
          <div className="space-y-3">
            <h1 className="whitespace-pre-line text-[clamp(2rem,3.4vw,3.1rem)] font-extrabold leading-[1.1] tracking-tight">
              {t("heroHeadline")}
            </h1>
            <p className="max-w-md text-white/70">{t("heroSub")}</p>
          </div>

          {/* portfolio glance card */}
          <div className="max-w-md rounded-[22px] border border-white/15 bg-white/[0.07] p-6 backdrop-blur">
            <div className="text-sm text-white/60">{t("glanceLabel")}</div>
            <div className="mt-1 flex items-center gap-3">
              <span className="font-mono text-3xl font-extrabold tabular-nums">{demoAmount}</span>
              <span className="rounded-full bg-[rgba(56,225,164,0.18)] px-2 py-0.5 text-sm font-semibold text-[#5FEAB6]">
                ▲ {demoGain}
              </span>
            </div>
            <svg
              viewBox="0 0 320 56"
              className="mt-4 h-12 w-full"
              fill="none"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                d="M0 44 L40 40 L80 42 L120 30 L160 34 L200 22 L240 26 L280 14 L320 10"
                stroke="#38E1A4"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-white/60">
              {t("connected")}
              <span className="font-medium text-white/90">Trade Republic · IBKR · DKB</span>
            </div>
          </div>
        </div>
      </section>

      {/* Auth panel */}
      <section className="flex flex-1 items-center justify-center bg-background p-6 md:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">
              {needsSetup ? t("setupKicker") : t("kicker")}
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight">
              {needsSetup ? t("setupTitle") : t("signInTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {needsSetup ? t("setupSub") : t("signInSub")}
            </p>
          </div>

          {devBypass ? (
            <Button asChild className="w-full gap-2" size="lg">
              <Link href="/holdings">
                {t("devEnter")}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : needsSetup ? (
            <SetupForm />
          ) : (
            <>
              {!localAuthAvailable && authentikAvailable && (
                <Button onClick={startSso} disabled={busy} className="w-full gap-2" size="lg">
                  {busy ? <Spinner size="sm" /> : <Shield className="size-4" />}
                  {busy ? t("ssoBusy") : t("sso")}
                </Button>
              )}

              {!localAuthAvailable && authentikAvailable && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {t("orEmail")}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}

              <form className="space-y-4" onSubmit={handleSubmit}>
                {loginError && <InlineError>{t("loginError")}</InlineError>}
                <div className="space-y-1.5">
                  <Label htmlFor="email">{t("emailLabel")}</Label>
                  <Input
                    id="email"
                    // `name` is what handleSubmit's FormData reads — without it
                    // formData.get("email") is null and the credentials POST carries
                    // "email=null" regardless of what was typed.
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder={t("emailPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">{t("passwordLabel")}</Label>
                    {/* No self-service reset flow yet — offering it here would be a
                        dead end (see landing.test.tsx / the local-auth gap it fixed). */}
                    {!localAuthAvailable && (
                      <button
                        type="button"
                        onClick={startSso}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {t("forgot")}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? t("hidePassword") : t("showPassword")}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={busy}
                  className="w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
                >
                  {busy ? <Spinner size="sm" /> : t("signIn")}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>
              </form>
            </>
          )}

          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            {devBypass ? t("devEnterHint") : needsSetup ? t("setupTrust") : t("trust")}
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * First-run "create your admin account" form — only ever shown while the deployment
 * has zero users (see the `needsSetup` prop above). Posts to the same-origin
 * /api/local-auth-setup proxy (POST /auth/local/setup has no session to gate on, so it
 * can't reuse the authenticated app/api/backend proxy), then signs in with the same
 * credentials so the new admin lands straight in the app.
 */
function SetupForm() {
  const t = useTranslations("Landing");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("setupPasswordTooShort", { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t("setupPasswordMismatch"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/local-auth-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(res.status === 409 ? t("setupAlreadyDone") : t("setupError"));
        setBusy(false);
        return;
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        // Account was created but the follow-up sign-in failed — send them to the
        // ordinary sign-in form (now populated, since setup just closed) instead of
        // stranding them on a form that will 409 if resubmitted.
        router.push("/");
        return;
      }
      router.push("/holdings");
    } catch {
      setError(t("setupError"));
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error && <InlineError>{error}</InlineError>}
      <div className="space-y-1.5">
        <Label htmlFor="setup-email">{t("emailLabel")}</Label>
        <Input
          id="setup-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="setup-password">{t("passwordLabel")}</Label>
        <Input
          id="setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="setup-confirm-password">{t("setupConfirmLabel")}</Label>
        <Input
          id="setup-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="w-full gap-2 bg-foreground text-background hover:bg-foreground/90"
      >
        {busy ? <Spinner size="sm" /> : t("setupSubmit")}
        {!busy && <ArrowRight className="size-4" />}
      </Button>
    </form>
  );
}
