import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Table, TableBody, TableCell, TableRow } from "../src/components/ui/table";

function renderTable(cell: React.ReactNode) {
  return render(
    <Table>
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

  it("leaves a plain cell left-aligned", () => {
    renderTable(<TableCell>Name</TableCell>);
    expect(screen.getByRole("cell", { name: "Name" }).className).not.toContain("text-right");
  });
});
