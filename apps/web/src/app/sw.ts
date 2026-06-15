import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
