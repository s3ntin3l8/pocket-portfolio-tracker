import type { HandlerDidErrorCallbackParam, PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, NetworkOnly, Serwist } from "serwist";
import { resolveLocalePrefix } from "./sw-locale";
import { routing } from "../i18n/routing";

// `__SW_MANIFEST` is injected by @serwist/next at build time (the app-shell precache
// list). Financial data is NOT cached here: `defaultCache` only matches same-origin
// Next assets/navigations, and the Fastify API is a different origin, so API reads
// always hit the network (fresh online, "unavailable" card offline).
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Cache + key the Web Share Target stashes a shared screenshot under. The transactions
// page (`?shared=1`) reads it back out, then deletes it. See `share_target` in the manifest.
export const SHARE_CACHE = "share-target";
export const SHARE_KEY = "/shared-image";
export const PUBLIC_STATIC_CACHE = "public-static-v1";

// Drop runtime caches created by older workers (which cached personalized pages) as
// soon as this worker activates. The precache contains only build-time public assets.
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== PUBLIC_STATIC_CACHE && !name.startsWith("serwist-precache"))
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

// Web Share Target: Android delivers a shared image as a multipart POST to
// `/share-target` (no server route can receive it in a static/SSR app, so the SW does).
// Stash the file in the Cache and redirect to /transactions, where the Add-transaction
// menu auto-opens the import sheet and picks it up.
self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;

  event.respondWith(
    (async () => {
      // Read the active locale from the NEXT_LOCALE cookie (set by next-intl's middleware).
      // The share-target POST comes from the OS, so the cookie should be present on the
      // request.
      const cookieHeader = event.request.headers.get("cookie") ?? "";
      const localePrefix = resolveLocalePrefix(cookieHeader);

      try {
        const form = await event.request.formData();
        const image = form.get("image");
        if (image instanceof Blob && image.size > 0) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            SHARE_KEY,
            new Response(image, {
              headers: { "content-type": image.type || "image/png" },
            }),
          );
          return Response.redirect(`${localePrefix}/transactions?shared=1`, 303);
        }
      } catch {
        // Fall through to a plain redirect so the user still lands on the transactions page.
      }
      return Response.redirect(`${localePrefix}/transactions`, 303);
    })(),
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // A new SW parks in "waiting" instead of activating immediately, so PwaUpdater can
  // detect it and prompt the user to reload rather than swapping the app out from under
  // them silently. It only activates once `messageSkipWaiting()` is sent (from the
  // toast's "Reload" action) — Serwist's `addEventListeners()` below wires up the
  // `SKIP_WAITING` message listener that triggers `self.skipWaiting()`.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  // Only immutable Next build assets are cached at runtime. Pages, RSC payloads, auth,
  // and API responses can contain account data, so they always go to the network.
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({ cacheName: PUBLIC_STATIC_CACHE }),
    },
    {
      matcher: ({ sameOrigin }) => sameOrigin,
      handler: new NetworkOnly(),
    },
  ],
  // Serve the precached offline page when a navigation can't be fulfilled while offline.
  // Routes are localized under /[locale]; match each non-default locale's own offline
  // page by its path prefix first, falling back to the default locale's for everything
  // else (including unprefixed/unrecognized paths).
  fallbacks: {
    entries: [
      ...routing.locales
        .filter((locale) => locale !== routing.defaultLocale)
        .map((locale) => ({
          url: `/${locale}/offline`,
          matcher: ({ request }: HandlerDidErrorCallbackParam) =>
            request.destination === "document" &&
            new URL(request.url).pathname.startsWith(`/${locale}/`) &&
            !new URL(request.url).pathname.startsWith("/api"),
        })),
      {
        url: `/${routing.defaultLocale}/offline`,
        matcher: ({ request }: HandlerDidErrorCallbackParam) =>
          request.destination === "document" && !new URL(request.url).pathname.startsWith("/api"),
      },
    ],
  },
});

serwist.addEventListeners();
