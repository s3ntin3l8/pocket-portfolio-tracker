"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import "./globals.css";

const COPY = { en: en.Error, id: id.Error } as const;

/**
 * Last-resort boundary for a failure in the root layout itself (where [locale]/error.tsx
 * cannot render, since it lives inside that layout). It REPLACES the root layout, so it
 * owns <html>/<body> and has no next-intl provider — the Error namespace is read straight
 * from the message files and the language follows the URL locale prefix, else the browser language (English
 * on first paint, to keep hydration stable).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [lang, setLang] = useState<keyof typeof COPY>("en");

  useEffect(() => {
    console.error(error);
    // The URL's locale prefix wins (that's the language the user was just reading); the
    // browser language is the fallback. `document.documentElement.lang` is deliberately NOT
    // read: React adopts this component's own <html lang> onto the live document on commit.
    const urlLocale = window.location.pathname.split("/")[1]?.toLowerCase();
    const preferred = urlLocale === "id" || urlLocale === "en" ? urlLocale : navigator.language;
    // "in" is the legacy ISO 639-1 code some browsers still report for Indonesian.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration locale pick (first paint stays English so hydration matches)
    setLang(/^(id|in)\b/.test(preferred.toLowerCase()) ? "id" : "en");
  }, [error]);

  const t = COPY[lang];

  return (
    <html lang={lang} suppressHydrationWarning>
      <body className="min-h-app-viewport bg-background font-sans text-foreground antialiased">
        <div className="flex min-h-dvh items-center justify-center">
          <ErrorState
            icon={AlertTriangle}
            tone="warn"
            eyebrow="500"
            title={t.title}
            body={t.body}
            code={error.digest ? `REF · ${error.digest}` : undefined}
            primary={<Button onClick={reset}>{t.retry}</Button>}
          />
        </div>
      </body>
    </html>
  );
}
