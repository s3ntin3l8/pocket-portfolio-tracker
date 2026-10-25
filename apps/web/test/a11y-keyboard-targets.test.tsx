import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { DisposalTable } from "../src/components/tax/disposal-table";
import { ByYearTable } from "../src/components/tax/year-table";
import { Field } from "../src/components/import-review/edit-dialog";
import { Field as StorageField } from "../src/components/admin-storage/field";
import { Input } from "../src/components/ui/input";
import { Spinner } from "../src/components/ui/spinner";
import { AssistantMarkdown } from "../src/components/assistant/assistant-markdown";
import { InstrumentLotsTable } from "../src/components/instrument-lots-table";
import { MobileIntro, type MobileSlideCopy } from "../src/components/onboarding/mobile-intro";
import { BenchmarkSettingsForm } from "../src/components/settings-sections/benchmark-settings-form";
import { GlobalSearch } from "../src/components/global-search";
import { onActivateKey } from "../src/lib/a11y";
import { signToneClass as signTone } from "../src/lib/tone";
import type { TaxDisposalRow } from "../src/lib/server-api";

// The command palette and the benchmark form reach for the router and the API client;
// neither is available outside the app shell.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    globalSearch: vi.fn().mockResolvedValue({ instruments: [], transactions: [] }),
  }),
}));

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

/**
 * jsdom has no layout engine, so a target's rendered size can only be read from the
 * Tailwind classes it declares. Tailwind's spacing scale is 0.25rem per unit
 * (`size-6` → 24px) and the app's root font size is 16px.
 */
const TAILWIND_UNIT_PX = 4;

/** The px value of one Tailwind spacing token (`6` → 24px, `1.75` → 7px). */
function tokenPx(token: string): number | null {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  if (!/^\d+(\.\d+)?$/.test(token)) return null;
  return Number(token) * TAILWIND_UNIT_PX;
}

/** The box the element's classes give it, per axis (null when it declares none). */
function declaredBoxPx(el: Element): { width: number | null; height: number | null } {
  const classes = [...el.classList];
  const size = classes.find((c) => c.startsWith("size-"));
  const axis = (a: "h" | "w"): number | null => {
    const exact = classes.find((c) => c.startsWith(`${a}-`));
    const min = classes.find((c) => c.startsWith(`min-${a}-`));
    const exactPx = size
      ? tokenPx(size.slice("size-".length))
      : exact
        ? tokenPx(exact.slice(a.length + 1))
        : null;
    const minPx = min ? tokenPx(min.slice(`min-${a}-`.length)) : null;
    const px = Math.max(exactPx ?? 0, minPx ?? 0);
    return px > 0 ? px : null;
  };
  return { width: axis("w"), height: axis("h") };
}

/** Every rendered table must carry an accessible name (audit R4-D5). */
function expectTablesNamed(container: HTMLElement) {
  const tables = [...container.querySelectorAll("table")];
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) {
    const name = table.getAttribute("aria-label") ?? table.querySelector("caption")?.textContent;
    expect((name ?? "").trim()).not.toBe("");
  }
}

describe("target size (WCAG 2.5.8)", () => {
  it("gives every onboarding slide dot a 24x24 hit area", () => {
    const slides: MobileSlideCopy[] = [
      { h: "Net worth", s: "One number", kind: "card", bullets: [] },
      { h: "Holders", s: "Everyone", kind: "glyph", bullets: [] },
      { h: "Tax", s: "German and Indonesian", kind: "glyph", bullets: [] },
      { h: "Data", s: "Screenshots, CSV, PDF", kind: "glyph", bullets: [] },
    ];
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MobileIntro
          copy={{
            skip: "Skip",
            getStarted: "Get started",
            haveAccount: "I already have an account",
            netWorthLabel: "Net worth",
            netWorthValue: "EUR 1,234",
            netWorthPill: "Live",
            slides,
          }}
          slide={0}
          onGoToSlide={() => {}}
          onEnter={() => {}}
        />
      </NextIntlClientProvider>,
    );
    const dots = screen.getAllByRole("button", { name: /go to slide/i });
    expect(dots).toHaveLength(slides.length);
    for (const dot of dots) {
      const box = declaredBoxPx(dot);
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
  });

  it("gives the remove-benchmark button a 24x24 hit area", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BenchmarkSettingsForm
          symbols={[{ symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 }]}
          rate={null}
        />
      </NextIntlClientProvider>,
    );
    const remove = screen.getByRole("button", { name: messages.Settings.removeBenchmark });
    const box = declaredBoxPx(remove);
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});

describe("table names", () => {
  it("names the German disposals table", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DisposalTable
          rows={[row("IWDA", "100")]}
          totalProceeds="40"
          totalGain="100"
          currency="EUR"
          locale="en"
          year={2026}
        />
      </NextIntlClientProvider>,
    );
    expectTablesNamed(container);
    expect(container.querySelector("table")?.getAttribute("aria-label")).toBe(
      messages.Tax.disposals.title,
    );
  });

  it("names the per-year tax table", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ByYearTable
          rows={[{ year: 2026, realized: "240", dividends: "168", fsaUsed: "408", tax: "0" }]}
          currency="EUR"
          locale="en"
        />
      </NextIntlClientProvider>,
    );
    expectTablesNamed(container);
    expect(container.querySelector("table")?.getAttribute("aria-label")).toBe(
      messages.Tax.byYear.title,
    );
  });

  it("names the open-lots table", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <InstrumentLotsTable
          lots={[{ acqDate: "2024-01-15", qty: "50", unitCost: "9500", cost: "475000" }]}
          currency="IDR"
        />
      </NextIntlClientProvider>,
    );
    expectTablesNamed(container);
    expect(container.querySelector("table")?.getAttribute("aria-label")).toBe(
      messages.Instrument.openLots,
    );
  });

  it("names the table in the assistant's answer", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AssistantMarkdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />
      </NextIntlClientProvider>,
    );
    expectTablesNamed(container);
    expect(container.querySelector("table")?.getAttribute("aria-label")).toBe(messages.A11y.table);
  });
});

describe("spinner", () => {
  it("announces itself as a status region with an accessible name", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Spinner />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveAccessibleName(messages.A11y.loading);
  });

  it("names itself from the catalogue", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Spinner />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveAccessibleName(messages.A11y.loading);
  });
});

describe("command palette", () => {
  it("names the input independently of its placeholder", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <GlobalSearch />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: messages.Search.triggerLabel }));
    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-label", messages.Search.inputLabel);
    expect(input.getAttribute("aria-label")).not.toBe(input.getAttribute("placeholder"));
  });
});
