"use client";

import { useEffect, useState, useCallback, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Module-scope capture of `beforeinstallprompt`.
 *
 * Chrome fires this event once, early in the page lifecycle — often before any React
 * component has mounted — and never re-fires it on a client-side (SPA) navigation.
 * Capturing it from inside a component's `useEffect` races this and reliably loses:
 * by the time e.g. a settings sub-page mounts, the event already fired and there's no
 * way to get it back. Registering the listener here, at module load, catches it
 * regardless of what's mounted at the time, and the deferred prompt survives
 * navigation for the rest of the page's lifetime. Every `usePwaInstall()` instance
 * subscribes to this single store via `useSyncExternalStore`.
 */
let capturedPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function notify() {
  for (const fn of subscribers) fn();
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

function getPromptSnapshot(): BeforeInstallPromptEvent | null {
  return capturedPrompt;
}

function getServerPromptSnapshot(): null {
  return null;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    capturedPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    capturedPrompt = null;
    notify();
  });
}

/** Test-only: clears the module-level singleton between test cases. */
export function resetPwaInstallStateForTests() {
  capturedPrompt = null;
  notify();
}

export function usePwaInstall() {
  const deferred = useSyncExternalStore(subscribe, getPromptSnapshot, getServerPromptSnapshot);
  const [eligible, setEligible] = useState<{ ios: boolean } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEligible({ ios: isIos() });
  }, []);

  const install = useCallback(async () => {
    if (!capturedPrompt) return;
    await capturedPrompt.prompt();
    await capturedPrompt.userChoice;
    capturedPrompt = null;
    notify();
  }, []);

  return { deferred, eligible, install, isStandalone: isStandalone() };
}
