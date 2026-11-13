import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const getSessionState = vi.fn();
let devBypass = false;

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "authjs.session-token", value: "abc" }],
    get: () => undefined,
  }),
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/components/landing", () => ({ Landing: () => null }));
vi.mock("@/lib/dev-auth", () => ({ isDevAuthBypass: () => devBypass }));
vi.mock("@/lib/session-token", () => ({
  getSessionState: (c: string) => getSessionState(c),
}));

async function renderPage() {
  const { default: Page } = await import("../src/app/[locale]/page");
  return Page({ params: Promise.resolve({ locale: "en" }) });
}

describe("landing page session redirect", () => {
  beforeEach(() => {
    vi.resetModules();
    redirect.mockClear();
    getSessionState.mockReset();
    devBypass = false;
    process.env.AUTH_SECRET = "test-secret"; // pragma: allowlist secret
  });

  it("sends a signed-in visitor to /holdings", async () => {
    getSessionState.mockResolvedValue({ isAuthenticated: true, isExpired: false, token: "t" });
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/en/holdings");
    expect(getSessionState).toHaveBeenCalledWith("authjs.session-token=abc");
  });

  it("still redirects when the access token is expired (the app layout rotates it)", async () => {
    getSessionState.mockResolvedValue({ isAuthenticated: true, isExpired: true, token: "t" });
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT:/en/holdings");
  });

  it("renders the landing for an anonymous visitor", async () => {
    getSessionState.mockResolvedValue({ isAuthenticated: false, isExpired: false, token: null });
    await renderPage();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not check the session under the dev bypass", async () => {
    devBypass = true;
    await renderPage();
    expect(getSessionState).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
