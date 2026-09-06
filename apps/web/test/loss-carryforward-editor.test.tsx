import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { TaxTranslator } from "../src/components/tax/tax-cards";

const refresh = vi.fn();
const getLossCarryforward = vi.fn(async () => ({ taxYear: 2026, entries: [] }));
const setLossCarryforward = vi.fn(async () => ({ taxYear: 2026, entries: [] }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ getLossCarryforward, setLossCarryforward }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LossCarryforwardEditor } from "../src/components/tax/loss-carryforward-editor";

function makeT(): TaxTranslator {
  const tax = messages.Tax as unknown as Record<string, unknown>;
  return (key, values) => {
    let val: unknown = tax;
    for (const part of key.split(".")) {
      val = (val as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof val !== "string") return key;
    if (!values) return val;
    return val.replace(/\{(\w+)\}/g, (_, k: string) =>
      values[k] !== undefined ? String(values[k]) : `{${k}}`,
    );
  };
}

const t = makeT();

function renderEditor(currentYear = 2026) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LossCarryforwardEditor holderId="holder-1" currentYear={currentYear} t={t} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  getLossCarryforward.mockClear();
  setLossCarryforward.mockClear();
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
    await waitFor(() => expect(getLossCarryforward).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(setLossCarryforward).toHaveBeenCalledWith(
        "holder-1",
        expect.objectContaining({ taxYear: 2026 }),
      ),
    );
  });

  it("strips a minus sign from entered amounts instead of silently accepting a negative loss", () => {
    renderEditor(2026);
    const [stockInput] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(stockInput, { target: { value: "-500" } });
    expect(stockInput.value).toBe("500");
  });
});
