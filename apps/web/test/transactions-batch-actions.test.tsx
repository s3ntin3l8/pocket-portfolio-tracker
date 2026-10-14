import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const { refresh, apiMock, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  apiMock: {
    bulkDeleteTransactions: vi.fn(),
    resolveDraftTransactions: vi.fn(),
    reassignTransactions: vi.fn(),
  },
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({ useApiClient: () => apiMock }));
vi.mock("sonner", () => ({ toast }));

import { useBatchActions } from "../src/components/transactions-table/batch-actions";

const ENTRIES = [
  { id: "a", portfolioId: "p1", status: "draft" },
  { id: "b", portfolioId: "p1", status: "confirmed" },
  { id: "c", portfolioId: "p2", status: "draft" },
];

function setup(clearSelection = vi.fn()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
  const hook = renderHook(() => useBatchActions({ selectedEntries: ENTRIES, clearSelection }), {
    wrapper,
  });
  return { ...hook, clearSelection };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.bulkDeleteTransactions.mockResolvedValue(undefined);
  apiMock.resolveDraftTransactions.mockResolvedValue(undefined);
});

describe("useBatchActions", () => {
  it("batch-deletes per portfolio, clears selection, refreshes and closes the confirm", async () => {
    const { result, clearSelection } = setup();
    act(() => result.current.setConfirming(true));
    await act(() => result.current.onBatchDelete());
    expect(apiMock.bulkDeleteTransactions).toHaveBeenCalledWith("p1", ["a", "b"]);
    expect(apiMock.bulkDeleteTransactions).toHaveBeenCalledWith("p2", ["c"]);
    expect(clearSelection).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(result.current.confirming).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it("batch-resolves only drafts", async () => {
    const { result } = setup();
    await act(() => result.current.onBatchResolve("confirm"));
    expect(apiMock.resolveDraftTransactions).toHaveBeenCalledWith("p1", ["a"], "confirm");
    expect(apiMock.resolveDraftTransactions).toHaveBeenCalledWith("p2", ["c"], "confirm");
    expect(apiMock.resolveDraftTransactions).toHaveBeenCalledTimes(2);
  });

  it("toasts and swallows a transfer-cost-basis refusal on a single resolve", async () => {
    const { ApiError } = await import("@portfolio/api-client");
    apiMock.resolveDraftTransactions.mockRejectedValueOnce(
      new ApiError(400, JSON.stringify({ error: "transfer_cost_basis_required" })),
    );
    const { result } = setup();
    await act(() =>
      result.current.onResolveOne({ id: "a", portfolioId: "p1" } as never, "confirm"),
    );
    expect(toast.error).toHaveBeenCalled();
    expect(result.current.resolvingId).toBeNull();
  });

  it("reassigns, summarises the result and clears the dialog", async () => {
    apiMock.reassignTransactions.mockResolvedValue({
      moved: 1,
      skippedConflicts: 0,
      skippedLoans: 0,
    });
    const { result, clearSelection } = setup();
    act(() => result.current.setReassignRows(ENTRIES));
    await act(() => result.current.doReassign("p2"));
    // Rows already in the target portfolio are not sent.
    expect(apiMock.reassignTransactions).toHaveBeenCalledTimes(1);
    expect(apiMock.reassignTransactions).toHaveBeenCalledWith("p1", ["a", "b"], "p2");
    expect(toast.success).toHaveBeenCalled();
    expect(result.current.reassignRows).toBeNull();
    expect(clearSelection).toHaveBeenCalled();
  });
});
