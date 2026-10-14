import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SortableTableHead } from "../src/components/ui/sortable-table-head";
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
