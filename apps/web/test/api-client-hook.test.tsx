import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useApiClient, apiBaseUrl } from "../src/lib/api";
import messages from "../messages/en.json";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
// Stable router identity, like Next's real one — the client is memoised on it.
const { routerStub } = vi.hoisted(() => ({ routerStub: {} as { push?: unknown } }));
vi.mock("next/navigation", () => ({
  useRouter: () => {
    routerStub.push = pushMock;
    return routerStub;
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="id" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function stub401(error: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error }), {
          status: error === "invalid_current_password" ? 400 : 401,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

function stubFetch() {
  const spy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => [],
    text: async () => "[]",
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", spy);
  return spy as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockReset();
  sessionStorage.clear();
});

describe("useApiClient", () => {
  it("targets the same-origin backend proxy, not the API directly", () => {
    expect(apiBaseUrl).toBe("/api/backend");
  });

  it("sends no client-held Authorization header — the proxy attaches the token server-side", async () => {
    const fetchSpy = stubFetch();

    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.listPortfolios();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/backend"),
      expect.anything(),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("returns a stable client across re-renders", () => {
    const { result, rerender } = renderHook(() => useApiClient(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it.each(["missing_token", "invalid_token", "unauthorized"])(
    "redirects to the locale landing page on a 401 %s",
    async (code) => {
      stub401(code);
      const { result } = renderHook(() => useApiClient(), { wrapper });
      await result.current.listPortfolios().catch(() => undefined);
      expect(pushMock).toHaveBeenCalledWith("/id");
    },
  );

  it("flags auth_migrated_relogin and redirects", async () => {
    stub401("auth_migrated_relogin");
    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.listPortfolios().catch(() => undefined);
    expect(sessionStorage.getItem("pocket:auth-migrated")).toBe("1");
    expect(pushMock).toHaveBeenCalledWith("/id");
  });

  it("does not redirect on an unrelated 401 or on a 400", async () => {
    stub401("email_unverified");
    const { result } = renderHook(() => useApiClient(), { wrapper });
    await result.current.listPortfolios().catch(() => undefined);
    stub401("invalid_current_password");
    await result.current.listPortfolios().catch(() => undefined);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
