"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { pushSupported, urlBase64ToUint8Array } from "@/lib/push";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

type Availability = "loading" | "off" | "unsupported" | "ready";

/**
 * Opt-in for Web Push on THIS device (a subscription belongs to one browser profile).
 * Renders nothing when the server has no VAPID keys, so there is never a dead control.
 */
export function PushNotificationsToggle() {
  const t = useTranslations("Settings");
  const api = useApiClient();
  const [availability, setAvailability] = useState<Availability>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const labelId = useId();

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cfg = await api.getPushConfig();
        if (!active) return;
        if (!cfg.enabled || !cfg.publicKey) return setAvailability("off");
        if (!pushSupported()) return setAvailability("unsupported");
        setPublicKey(cfg.publicKey);
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (!active) return;
        setOn(Boolean(existing) && Notification.permission === "granted");
        setAvailability("ready");
      } catch {
        if (active) setAvailability("off");
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(t("notificationsDenied"));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("bad sub");
      await api.subscribePush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      setOn(true);
    } catch {
      setMessage(t("notificationsError"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setOn(false);
    } catch {
      setMessage(t("notificationsError"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.testPush();
      setMessage(res.sent > 0 ? t("notificationsTestSent") : t("notificationsError"));
    } catch {
      setMessage(t("notificationsError"));
    } finally {
      setBusy(false);
    }
  }

  if (availability === "loading" || availability === "off") return null;

  return (
    <div className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold">
            {t("notificationsLabel")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {availability === "unsupported"
              ? t("notificationsUnsupported")
              : t("notificationsHint")}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={busy || availability === "unsupported"}
          aria-labelledby={labelId}
          onCheckedChange={(next) => void (next ? enable() : disable())}
        />
      </div>
      {on && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void sendTest()}
        >
          {t("notificationsTest")}
        </Button>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
