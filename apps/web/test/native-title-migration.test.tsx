import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SortableTableHead } from "../src/components/ui/sortable-table-head";
import { RowActions } from "../src/components/import-history/rows";
import { ExportCsvButton } from "../src/components/export-csv-button";

function renderHead(onToggle = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <SortableTableHead
            colKey="annualized"
            sortKey={null}
            sortDir="asc"
            onToggle={onToggle}
            hint="Annualized hint"
          >
            Annualized
          </SortableTableHead>
        </tr>
      </thead>
    </table>,
  );
  return onToggle;
}

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("import-history review link tooltip", () => {
  it("opens on keyboard focus of the rendered anchor (InfoTip > Button asChild > Link)", async () => {
    render(
      <RowActions
        imp={{ id: "i1", status: "draft", count: 1 } as never}
        busyId={null}
        confirmId={null}
        canReassign={false}
        t={(k: string) => k}
        onDiscard={vi.fn()}
        onClear={vi.fn()}
        onUndo={vi.fn()}
        onDownload={vi.fn()}
        onReassign={vi.fn()}
        onSetConfirmId={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: "review" });
    expect(link.getAttribute("title")).toBeNull();
    act(() => link.focus());
    expect((await screen.findAllByText("review")).length).toBeGreaterThan(0);
  });
});

describe("SortableTableHead hint", () => {
  it("renders the hint as a sibling control, not nested in the sort button", async () => {
    const onToggle = renderHead();
    const info = screen.getByRole("button", { name: "Annualized hint" });
    const sort = screen.getByRole("button", { name: /Annualized$/ });
    expect(sort.contains(info)).toBe(false);
    expect(info.getAttribute("title")).toBeNull();
    fireEvent.click(sort);
    expect(onToggle).toHaveBeenCalledWith("annualized");
  });

  it("opens the tooltip on keyboard focus", async () => {
    renderHead();
    act(() => screen.getByRole("button", { name: "Annualized hint" }).focus());
    expect((await screen.findAllByText("Annualized hint")).length).toBeGreaterThan(0);
  });
});

describe("icon-only export button tooltip", () => {
  it("has no native title and shows its label on focus", async () => {
    render(
      <ExportCsvButton
        rows={[["a"]]}
        headers={["h"]}
        filename="x.csv"
        label="Export CSV"
        iconOnly
      />,
    );
    const btn = screen.getByRole("button", { name: "Export CSV" });
    expect(btn.getAttribute("title")).toBeNull();
    act(() => btn.focus());
    expect((await screen.findAllByText("Export CSV")).length).toBeGreaterThan(0);
  });
});

describe("SortableTableHead hint, right-aligned", () => {
  it("keeps right anchoring, puts the info control after the sort button, and still sorts", () => {
    const onToggle = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortableTableHead
              colKey="annualized"
              sortKey={null}
              sortDir="asc"
              onToggle={onToggle}
              align="right"
              hint="Annualized hint"
            >
              Annualized
            </SortableTableHead>
          </tr>
        </thead>
      </table>,
    );
    const th = screen.getByRole("columnheader");
    expect(th.className).toContain("text-right");
    const wrapper = th.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("justify-end");
    const [sort, info] = Array.from(wrapper.querySelectorAll("button"));
    expect(sort.textContent).toContain("Annualized");
    expect(info.getAttribute("aria-label")).toBe("Annualized hint");
    expect(sort.contains(info)).toBe(false);
    fireEvent.click(sort);
    expect(onToggle).toHaveBeenCalledWith("annualized");
  });
});
