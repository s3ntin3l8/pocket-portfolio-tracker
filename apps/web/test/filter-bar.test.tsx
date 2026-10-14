import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChip, YearFilterDropdown } from "../src/components/filter-bar";

describe("FilterChip", () => {
  it("reflects active state via aria-pressed and fires onClick", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FilterChip active={false} onClick={onClick}>
        Open
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Open" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <FilterChip active onClick={onClick}>
        Open
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "Open" }).getAttribute("aria-pressed")).toBe("true");
  });
});

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Year" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("YearFilterDropdown", () => {
  it("shows the all label when no year is selected and the year otherwise", () => {
    const { rerender } = render(
      <YearFilterDropdown
        value={null}
        options={["2024", "2025"]}
        onChange={() => {}}
        label="Year"
        allLabel="All years"
      />,
    );
    expect(screen.getByRole("button", { name: "Year" }).textContent).toBe("All years");
    rerender(
      <YearFilterDropdown
        value="2025"
        options={["2024", "2025"]}
        onChange={() => {}}
        label="Year"
        allLabel="All years"
      />,
    );
    expect(screen.getByRole("button", { name: "Year" }).textContent).toBe("2025");
  });

  it("maps the all item to null and a year item to the year", async () => {
    const onChange = vi.fn();
    render(
      <YearFilterDropdown
        value="2024"
        options={["2024", "2025"]}
        onChange={onChange}
        label="Year"
        allLabel="All years"
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "2025" }));
    expect(onChange).toHaveBeenLastCalledWith("2025");
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "All years" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
