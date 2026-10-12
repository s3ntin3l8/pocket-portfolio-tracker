import type { Metadata } from "next";

type Translate = (key: "ogTitle" | "ogDescription" | "ogImageAlt") => string;

const OG_LOCALES: Record<string, string> = { en: "en_US", id: "id_ID" };

/**
 * Social-preview (Open Graph / Twitter) metadata. `metadataBase` makes Next emit
 * *absolute* image URLs — link-preview crawlers (WhatsApp, Slack, …) ignore relative ones.
 * The image is the committed `public/og-image.jpg` (see scripts/generate-og-image.mjs).
 */
export function buildSiteMetadata({
  locale,
  baseUrl,
  t,
}: {
  locale: string;
  baseUrl: string;
  t: Translate;
}): Metadata {
  const title = t("ogTitle");
  const description = t("ogDescription");
  const images = [{ url: "/og-image.jpg", width: 1200, height: 630, alt: t("ogImageAlt") }];
  return {
    metadataBase: new URL(baseUrl),
    openGraph: {
      type: "website",
      siteName: "Pocket",
      url: "/",
      // Fallback only for callers that bypass the layout's `hasLocale` guard.
      locale: OG_LOCALES[locale] ?? OG_LOCALES.en,
      title,
      description,
      images,
    },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
