import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useApiClient, apiBaseUrl } from "../src/lib/api";

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

afterEach(() => vi.unstubAllGlobals());

describe("useApiClient", () => {
  it("targets the same-origin backend proxy, not the API directly", () => {
    expect(apiBaseUrl).toBe("/api/backend");
  });

  it("sends no client-held Authorization header — the proxy attaches the token server-side", async () => {
    const fetchSpy = stubFetch();

    const { result } = renderHook(() => useApiClient());
    await result.current.listPortfolios();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/backend"),
      expect.anything(),
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("returns a stable client across re-renders", () => {
    const { result, rerender } = renderHook(() => useApiClient());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
