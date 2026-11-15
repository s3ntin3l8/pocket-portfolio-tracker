import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { urlBase64ToUint8Array } from "../src/lib/push";

const api = {
  getPushConfig: vi.fn(),
  subscribePush: vi.fn(async () => ({ ok: true as const })),
  unsubscribePush: vi.fn(async () => undefined),
  testPush: vi.fn(async () => ({ sent: 1 })),
};
vi.mock("@/lib/api", () => ({ useApiClient: () => api }));

import { PushNotificationsToggle } from "../src/components/settings-sections/push-notifications-toggle";

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  toJSON: () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "P256", auth: "AUTH" },
  }),
  unsubscribe: vi.fn(async () => true),
};
const pushManager = {
  getSubscription: vi.fn(),
  subscribe: vi.fn(async () => subscription),
};

function installBrowser(permission: NotificationPermission) {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn(async () => permission),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
}

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PushNotificationsToggle />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pushManager.getSubscription.mockResolvedValue(null);
  api.getPushConfig.mockResolvedValue({ enabled: true, publicKey: "AQIDBA" });
});
afterEach(() => vi.unstubAllGlobals());

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with missing padding", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("PushNotificationsToggle", () => {
  it("renders nothing when the server has no push configured", async () => {
    installBrowser("default");
    api.getPushConfig.mockResolvedValue({ enabled: false, publicKey: null });
    const { container } = renderToggle();
    await waitFor(() => expect(api.getPushConfig).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("explains when the browser cannot receive push", async () => {
    vi.stubGlobal("PushManager", undefined);
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
    delete (window as unknown as Record<string, unknown>).PushManager;
    renderToggle();
    expect(await screen.findByText(/can't receive notifications/)).toBeTruthy();
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(true);
  });

  it("asks permission, subscribes and registers the device when switched on", async () => {
    installBrowser("granted");
    renderToggle();
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => expect(api.subscribePush).toHaveBeenCalledTimes(1));
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(api.subscribePush).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      keys: { p256dh: "P256", auth: "AUTH" },
    });
    expect(await screen.findByRole("button", { name: /Send a test/ })).toBeTruthy();
  });

  it("does not subscribe when the user blocks the permission", async () => {
    installBrowser("denied");
    renderToggle();
    fireEvent.click(await screen.findByRole("switch"));
    expect(await screen.findByText(/blocked for this site/)).toBeTruthy();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it("starts on for an existing subscription and unsubscribes on switch off", async () => {
    installBrowser("granted");
    pushManager.getSubscription.mockResolvedValue(subscription);
    renderToggle();
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(toggle);
    await waitFor(() => expect(api.unsubscribePush).toHaveBeenCalledWith(subscription.endpoint));
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("sends a test notification", async () => {
    installBrowser("granted");
    pushManager.getSubscription.mockResolvedValue(subscription);
    renderToggle();
    fireEvent.click(await screen.findByRole("button", { name: /Send a test/ }));
    expect(await screen.findByText(/Test notification sent/)).toBeTruthy();
  });
});
