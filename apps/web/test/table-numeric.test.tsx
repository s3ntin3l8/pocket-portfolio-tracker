import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableBody, TableCell, TableFooter, TableRow } from "../src/components/ui/table";

function renderTable(cell: React.ReactNode) {
  return render(
    <Table caption="Test table">
      <TableBody>
        <TableRow>{cell}</TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table", () => {
  it("sets the shared 13px body size on the table", () => {
    renderTable(<TableCell>x</TableCell>);
    expect(screen.getByRole("table").className).toContain("text-body-sm");
  });
});

describe("TableFooter", () => {
  it("shares the table body size", () => {
    const { container } = render(
      <Table caption="Test table">
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    expect(container.querySelector("tfoot")?.className).toContain("text-body-sm");
  });
});

describe("TableCell numeric", () => {
  it("right-aligns with tabular figures and still takes extra classes", () => {
    renderTable(
      <TableCell numeric className="font-semibold">
        1,000
      </TableCell>,
    );
    const cell = screen.getByRole("cell", { name: "1,000" });
    expect(cell.className).toContain("tabular");
    expect(cell.className).toContain("text-right");
    expect(cell.className).toContain("font-semibold");
  });

  it("lets a caller override the alignment", () => {
    renderTable(
      <TableCell numeric className="text-left">
        left
      </TableCell>,
    );
    const cell = screen.getByRole("cell", { name: "left" });
    expect(cell.className).toContain("text-left");
    expect(cell.className).not.toContain("text-right");
    expect(cell.className).toContain("tabular");
  });

  it("leaves a plain cell left-aligned and non-tabular", () => {
    renderTable(<TableCell>Name</TableCell>);
    const cls = screen.getByRole("cell", { name: "Name" }).className;
    expect(cls).not.toContain("text-right");
    expect(cls).not.toContain("tabular");
  });
});
