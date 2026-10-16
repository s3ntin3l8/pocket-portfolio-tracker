import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { DisposalTable } from "../src/components/tax/disposal-table";
import { Field } from "../src/components/import-review/edit-dialog";
import { Field as StorageField } from "../src/components/admin-storage/field";
import { Input } from "../src/components/ui/input";
import { onActivateKey } from "../src/lib/a11y";
import { signToneClass as signTone } from "../src/lib/tone";
import type { TaxDisposalRow } from "../src/lib/server-api";

const lot = (gain: string) => ({
  acqDate: "2021-01-15",
  quantity: "1",
  buyPrice: "10",
  sellPrice: "20",
  proceeds: "20",
  gain,
  holdingDays: 100,
  longTerm: true,
});

const row = (symbol: string, gain: string): TaxDisposalRow => ({
  symbol,
  when: "2026-04-01",
  proceeds: "40",
  gain,
  tfRate: "0",
  gainAdjusted: gain,
  quantity: "2",
  avgBuyPrice: "10",
  sellPrice: "20",
  lots: [lot(gain), lot(gain)],
});

function renderTable(rows: TaxDisposalRow[], totalGain: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DisposalTable
        rows={rows}
        totalProceeds="40"
        totalGain={totalGain}
        currency="EUR"
        locale="en"
        year={2026}
      />
    </NextIntlClientProvider>,
  );
}

describe("onActivateKey", () => {
  it("fires on Enter and Space for the element itself, not for bubbled child keys", () => {
    const fn = vi.fn();
    render(
      <div tabIndex={0} data-testid="host" onKeyDown={onActivateKey(fn)}>
        <button>inner</button>
      </div>,
    );
    fireEvent.keyDown(screen.getByTestId("host"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("host"), { key: " " });
    fireEvent.keyDown(screen.getByTestId("host"), { key: "a" });
    fireEvent.keyDown(screen.getByText("inner"), { key: "Enter" });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("tax disposal rows", () => {
  it("expand with the keyboard and expose aria-expanded", () => {
    renderTable([row("IWDA", "100")], "100");
    const tr = screen.getByText("IWDA").closest("tr")!;
    expect(tr).toHaveAttribute("tabindex", "0");
    expect(tr).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(tr, { key: "Enter" });
    expect(tr).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(tr, { key: " " });
    expect(tr).toHaveAttribute("aria-expanded", "false");
  });

  it("tones a loss red and a gain green instead of always green", () => {
    renderTable([row("GAIN", "100"), row("LOSS", "-50")], "50");
    const tones = (symbol: string) =>
      screen.getByText(symbol).closest("tr")!.querySelector("td:last-child span")!.className;
    expect(tones("GAIN")).toContain("text-success");
    expect(tones("LOSS")).toContain("text-destructive");
    // Literal class-substring guard only: jsdom does not compile Tailwind, so this cannot see computed colour.
    expect(tones("LOSS")).not.toContain("emerald");
  });
});

describe("signTone", () => {
  it("maps sign to tone", () => {
    expect(signTone(1)).toBe("text-success");
    expect(signTone(-1)).toBe("text-destructive");
    expect(signTone(0)).toBe("");
    expect(signTone(null)).toBe("");
  });
});

describe("import-review Field", () => {
  it("associates its label with the control", () => {
    render(
      <Field label="Quantity">
        <Input defaultValue="3" />
      </Field>,
    );
    expect(screen.getByLabelText("Quantity")).toHaveValue("3");
  });
});

describe("admin storage Field", () => {
  it("ties its label to the input", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <StorageField label="Bucket" value="b" source="db" onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByLabelText("Bucket")).toBeInstanceOf(HTMLInputElement);
  });
});
