import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useImportConfirm } from "@/lib/use-import-confirm";
import { withUid, type ImportDraft } from "@/components/import-flow/types";
import type { DuplicateMatch } from "@portfolio/api-client";

/**
 * The confirm hook owns the resolution of a duplicate conflict.
 *
 * Two things matter here:
 *
 *  - the conflict is resolved against the draft's *stable identity* (`externalId`), not
 *    against an array index — the server used to report an index into an array it had
 *    filtered before classifying, so the two could disagree and "Enrich existing" folded
 *    the wrong draft's tax data onto the matched transaction;
 *  - a duplicate can be *skipped* — the resolution the server could not express before.
 */

const DRAFT_A: ImportDraft = {
  assetClass: "equity",
  action: "buy",
  name: "Apple",
  quantity: "3",
  unit: "shares",
  price: "100",
  fees: "0",
  currency: "EUR",
  executedAt: "2026-03-01T00:00:00.000Z",
  confidence: 1,
  externalId: "draft-a",
};

const DRAFT_B: ImportDraft = {
  ...DRAFT_A,
  name: "Siemens",
  externalId: "draft-b",
};

const DRAFT_C: ImportDraft = {
  ...DRAFT_A,
  name: "Total",
  externalId: "draft-c",
};

function makeClient() {
  return {
    confirmImport: vi.fn().mockResolvedValue({ confirmed: 1 }),
    enrichImport: vi.fn().mockResolvedValue({ enriched: 1 }),
  };
}

function makeHook(drafts: ImportDraft[], client: ReturnType<typeof makeClient>) {
  const setDrafts = vi.fn();
  const rendered = renderHook(() =>
    useImportConfirm({
      importId: "imp-1",
      drafts: drafts.map((d, i) => withUid(d, "imp-1", i)),
      setDrafts,
      contracts: [],
      getPortfolioId: () => "pf-1",
      client: client as never,
      onFullSuccess: vi.fn(),
    }),
  );
  return { ...rendered, setDrafts };
}

describe("useImportConfirm — duplicate resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a conflict by externalId, not by the reported index", async () => {
    const client = makeClient();
    const { result } = makeHook([DRAFT_A, DRAFT_B], client);

    // The server reports index 0 — but that index is into the array *it* received, which
    // may have been filtered before classifying. The identity is authoritative.
    const duplicate: DuplicateMatch = {
      name: "Siemens",
      action: "buy",
      quantity: "3",
      executedAt: "2026-03-01",
      matchedSource: "csv",
      matchedExecutedAt: "2026-03-01",
      draftIndex: 0,
      externalId: "draft-b",
      matchedTransactionId: "tx-1",
    };

    // The conflict arrives from a confirm — that is what populates the pending subset the
    // resolution is resolved against.
    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.enrichOneDuplicate(duplicate);
    });

    await waitFor(() => expect(client.enrichImport).toHaveBeenCalledTimes(1));
    const [importId, payload] = client.enrichImport.mock.calls[0] as [
      string,
      Array<{ draft: { name?: string | null }; targetTransactionId: string }>,
    ];
    expect(importId).toBe("imp-1");
    // The *second* draft (Siemens) — not the first one the index pointed at.
    expect(payload[0].draft.name).toBe("Siemens");
    expect(payload[0].targetTransactionId).toBe("tx-1");
  });

  it("skips a duplicate: it is neither written nor enriched", async () => {
    const client = makeClient();
    const { result } = makeHook([DRAFT_A, DRAFT_B], client);

    const duplicate: DuplicateMatch = {
      name: "Siemens",
      action: "buy",
      quantity: "3",
      executedAt: "2026-03-01",
      matchedSource: "csv",
      matchedExecutedAt: "2026-03-01",
      draftIndex: 0,
      externalId: "draft-b",
      matchedTransactionId: "tx-1",
    };

    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.skipOneDuplicate(duplicate);
    });

    await waitFor(() => expect(client.confirmImport).toHaveBeenCalledTimes(2));
    // The re-confirm after the skip sends only the remaining draft: the skipped one is
    // simply not part of the import, so it cannot be written — and no resolution is left
    // pointing at another draft.
    const last = client.confirmImport.mock.calls.at(-1) as unknown[];
    const sent = last[1] as Array<{ name?: string }>;
    expect(sent.map((d) => d.name)).not.toContain("Siemens");
    expect(last[last.length - 1]).toEqual([]);
    expect(client.enrichImport).not.toHaveBeenCalled();
  });

  it("a skip in the middle never lands on the next draft", async () => {
    // The regression: the resolution was recorded as an index into the array that was sent
    // *before* the decision, then applied to the array sent *after* it — so skipping the
    // middle draft of [A, B, C] dropped C instead. Resolutions are held by identity and
    // translated to the index of the array actually sent.
    const client = makeClient();
    const { result } = makeHook([DRAFT_A, DRAFT_B, DRAFT_C], client);

    const duplicate: DuplicateMatch = {
      name: "Siemens",
      action: "buy",
      quantity: "3",
      executedAt: "2026-03-01",
      matchedSource: "csv",
      matchedExecutedAt: "2026-03-01",
      draftIndex: 1,
      externalId: "draft-b",
      matchedTransactionId: "tx-1",
    };

    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.skipOneDuplicate(duplicate);
    });

    await waitFor(() => expect(client.confirmImport).toHaveBeenCalledTimes(2));
    const [, sent, , , , , resolutions] = client.confirmImport.mock.calls[1] as unknown[];
    // The skipped draft is gone; the other two are still sent.
    expect((sent as Array<{ name?: string }>).map((d) => d.name)).toEqual(["Apple", "Total"]);
    // …and no resolution points at the wrong draft.
    expect(resolutions).toEqual([]);
  });

  it("sends the per-row resolutions with the confirm", async () => {
    const client = makeClient();
    const { result } = makeHook([DRAFT_A], client);

    const duplicate: DuplicateMatch = {
      name: "Apple",
      action: "buy",
      quantity: "3",
      executedAt: "2026-03-01",
      matchedSource: "csv",
      matchedExecutedAt: "2026-03-01",
      draftIndex: 0,
      externalId: "draft-a",
      matchedTransactionId: "tx-1",
    };

    await act(async () => {
      await result.current.confirm();
    });
    await act(async () => {
      await result.current.resolveDuplicate(duplicate, "import");
    });

    await waitFor(() => expect(client.confirmImport).toHaveBeenCalledTimes(2));
    const args = client.confirmImport.mock.calls.at(-1) as unknown[];
    // The resolutions are the last argument.
    expect(args[args.length - 1]).toEqual([{ draftIndex: 0, action: "import" }]);
  });
});
