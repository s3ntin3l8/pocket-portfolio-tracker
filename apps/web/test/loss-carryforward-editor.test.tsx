import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();
const getLossCarryforward = vi.fn();
const setLossCarryforward = vi.fn();
// One stable client object: the editor's load effect depends on the client's identity,
// so a fresh object per render would re-run the load on every render.
const apiClient = { getLossCarryforward, setLossCarryforward };

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({ useApiClient: () => apiClient }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LossCarryforwardEditor } from "../src/components/tax/loss-carryforward-editor";

const m = messages.Tax.lossCarryforward;
const retryLabel = messages.DataState.retry;

function renderEditor(currentYear = 2026) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LossCarryforwardEditor holderId="holder-1" currentYear={currentYear} />
    </NextIntlClientProvider>,
  );
}

/** Waits until the initial load has resolved and the editor is editable again. */
async function waitForLoaded() {
  await waitFor(() => expect(screen.getByRole("button", { name: m.save })).not.toBeDisabled());
}

beforeEach(() => {
  getLossCarryforward.mockReset();
  getLossCarryforward.mockResolvedValue({ taxYear: 2026, entries: [] });
  setLossCarryforward.mockReset();
  setLossCarryforward.mockResolvedValue({ taxYear: 2026, entries: [] });
  refresh.mockClear();
});

describe("LossCarryforwardEditor", () => {
  it("defaults the year selector to the year currently on screen, not the prior year", async () => {
    renderEditor(2026);
    await waitFor(() => expect(getLossCarryforward).toHaveBeenCalledWith("holder-1", 2026));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("2026");
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain("2026");
  });

  it("saves against the year currently on screen", async () => {
    renderEditor(2026);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(setLossCarryforward).toHaveBeenCalledWith(
        "holder-1",
        expect.objectContaining({ taxYear: 2026 }),
      ),
    );
  });

  it("strips a minus sign from entered amounts instead of silently accepting a negative loss", async () => {
    renderEditor(2026);
    await waitForLoaded();
    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(stockInput, { target: { value: "-500" } });
    expect(stockInput.value).toBe("500");
  });

  it("calls router.refresh() after a successful save to update server-rendered tax figures", async () => {
    renderEditor(2026);
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(setLossCarryforward).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // R4-A1 — a failed load must never leave a usable-looking editor on screen: saving
  // it would write zeros over a real carry-forward.
  it("keeps Save disabled and reports the failure when the load fails", async () => {
    getLossCarryforward.mockRejectedValueOnce(new Error("boom"));
    renderEditor(2026);

    expect(await screen.findByRole("alert")).toHaveTextContent(m.loadError);
    expect(screen.getByRole("button", { name: m.save })).toBeDisabled();
    expect(screen.getByRole("button", { name: retryLabel })).toBeInTheDocument();
    for (const input of screen.getAllByRole("textbox")) {
      expect(input).toHaveAttribute("readonly");
    }
    expect(setLossCarryforward).not.toHaveBeenCalled();
  });

  it("sends the amounts that were loaded, not a zero fallback", async () => {
    getLossCarryforward.mockResolvedValueOnce({
      taxYear: 2026,
      entries: [
        { pot: "stock", amount: "1234.56" },
        { pot: "general", amount: "78.90" },
      ],
    });
    renderEditor(2026);
    await waitForLoaded();

    // What the user sees is what gets saved — no zero fallback in between.
    const [stockInput, generalInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(stockInput).toHaveValue("1234.56");
    expect(generalInput).toHaveValue("78.90");

    fireEvent.click(screen.getByRole("button", { name: m.save }));
    await waitFor(() => expect(setLossCarryforward).toHaveBeenCalled());
    expect(setLossCarryforward).toHaveBeenCalledWith("holder-1", {
      taxYear: 2026,
      entries: [
        { pot: "stock", amount: "1234.56" },
        { pot: "general", amount: "78.90" },
      ],
    });
  });

  // R4-B3 — the minus sign is still stripped, but the user is told about it.
  it("explains that a dropped minus sign is ignored", async () => {
    renderEditor(2026);
    await waitForLoaded();
    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];

    fireEvent.change(stockInput, { target: { value: "-500" } });

    expect(stockInput.value).toBe("500");
    expect(screen.getByText(m.negativeIgnored)).toBeInTheDocument();
  });

  it("re-runs the load on retry and enables Save once it succeeds", async () => {
    getLossCarryforward.mockRejectedValueOnce(new Error("boom"));
    renderEditor(2026);
    const retry = await screen.findByRole("button", { name: retryLabel });

    getLossCarryforward.mockResolvedValueOnce({
      taxYear: 2026,
      entries: [{ pot: "stock", amount: "42" }],
    });
    fireEvent.click(retry);

    await waitFor(() => expect(getLossCarryforward).toHaveBeenCalledTimes(2));
    await waitForLoaded();
    expect(screen.queryByRole("alert")).toBeNull();
    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(stockInput).toHaveValue("42");
  });

  // R4-A1 — revisiting a year must not inherit the previous verdict for it. The
  // request key for 2026 is the same on the way back as it was on the way out, so a
  // stale "loaded" would make the blanked fields saveable — and saving an empty set
  // clears every pot for that year.
  it("does not make a revisited year saveable while its reload is still in flight", async () => {
    getLossCarryforward.mockResolvedValueOnce({
      taxYear: 2026,
      entries: [{ pot: "stock", amount: "1000" }],
    });
    renderEditor(2026);
    await waitForLoaded();

    const yearSelect = screen.getByRole("combobox");
    // 2026 → 2025 → back to 2026, with BOTH refetches still pending. The request key
    // for 2026 is then the same as it was on the first load, so a stale "loaded"
    // verdict would make the blanked fields saveable — and saving an empty set
    // clears every pot for that year.
    getLossCarryforward.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(yearSelect, { target: { value: "2025" } });
    await waitFor(() => expect(getLossCarryforward).toHaveBeenCalledTimes(2));

    getLossCarryforward.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(yearSelect, { target: { value: "2026" } });
    await waitFor(() => expect(getLossCarryforward).toHaveBeenCalledTimes(3));

    // The amounts on screen are unknown: Save must be off and nothing may be sent.
    expect(screen.getByRole("button", { name: m.save })).toBeDisabled();
    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(stockInput).toHaveValue("");
    expect(stockInput).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: m.save }));
    expect(setLossCarryforward).not.toHaveBeenCalled();
  });

  it("drops the minus-sign hint when the amounts are cleared for another year", async () => {
    getLossCarryforward.mockResolvedValueOnce({
      taxYear: 2026,
      entries: [{ pot: "stock", amount: "1000" }],
    });
    renderEditor(2026);
    await waitForLoaded();

    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(stockInput, { target: { value: "-500" } });
    expect(screen.getByText(m.negativeIgnored)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2025" } });

    await waitFor(() => expect(screen.queryByText(m.negativeIgnored)).not.toBeInTheDocument());
  });
});
