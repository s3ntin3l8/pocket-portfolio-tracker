import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTransactionUrlNav } from "../src/components/transactions-table/hooks";

const push = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/transactions",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

describe("useTransactionUrlNav", () => {
  beforeEach(() => {
    push.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  it("single-key form sets one param and pushes once", () => {
    const { result } = renderHook(() => useTransactionUrlNav());
    result.current("type", "buy");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/transactions?type=buy&page=1");
  });

  it("single-key form with undefined clears that key", () => {
    mockSearchParams = new URLSearchParams("type=buy&page=3");
    const { result } = renderHook(() => useTransactionUrlNav());
    result.current("type", undefined);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/transactions?page=1");
  });

  // The regression test for the bug this batch form exists to prevent: calling the
  // single-key form twice in the same handler (once for "type", once for "year") issues
  // two separate router.push() calls that both read the same pre-navigation
  // searchParams snapshot — a real race, observed live as "Clear all" resetting the year
  // filter, then it silently reappearing after closing the sheet right after. The batch
  // form does it as one push, so there's nothing left to race.
  it("batch form clears multiple keys in a single push, not one per key", () => {
    mockSearchParams = new URLSearchParams("type=buy&year=2026&page=3");
    const { result } = renderHook(() => useTransactionUrlNav());
    result.current({ type: undefined, year: undefined });

    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0][0], "http://x");
    expect(url.searchParams.get("type")).toBeNull();
    expect(url.searchParams.get("year")).toBeNull();
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("batch form can set some keys and clear others in the same push", () => {
    mockSearchParams = new URLSearchParams("type=buy");
    const { result } = renderHook(() => useTransactionUrlNav());
    result.current({ type: undefined, year: "2025" });

    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0][0], "http://x");
    expect(url.searchParams.get("type")).toBeNull();
    expect(url.searchParams.get("year")).toBe("2025");
  });
});
