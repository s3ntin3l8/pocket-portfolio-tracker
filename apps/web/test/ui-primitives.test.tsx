import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { Checkbox } from "../src/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "../src/components/ui/toggle-group";
import { InfoTip } from "../src/components/ui/tooltip";
import { RangeToggle } from "../src/components/charts/range-toggle";
import { InstrumentRangeToggle } from "../src/components/charts/instrument-range-toggle";

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Checkbox", () => {
  it("exposes role=checkbox with aria-checked and reports changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Checkbox aria-label="Select row" checked={false} onCheckedChange={onChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Select row" });
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Checkbox aria-label="Select row" checked onCheckedChange={onChange} />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("supports the indeterminate state and disabled", () => {
    render(<Checkbox aria-label="All" checked="indeterminate" disabled />);
    const box = screen.getByRole("checkbox", { name: "All" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box).toBeDisabled();
  });
});

describe("ToggleGroup", () => {
  it("marks the active item and fires only on a real change", () => {
    const onChange = vi.fn();
    render(
      <ToggleGroup value="b" onValueChange={onChange} aria-label="Pick">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(screen.getByRole("radiogroup", { name: "Pick" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "B" })); // deselect attempt ignored
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});

describe("range toggles", () => {
  it("RangeToggle selects ranges and honours the subset", () => {
    const onChange = vi.fn();
    wrap(<RangeToggle value="1m" onChange={onChange} ranges={["1m", "1y"]} />);
    expect(screen.getByRole("radio", { name: "1M" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radio", { name: "3M" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "1Y" }));
    expect(onChange).toHaveBeenCalledWith("1y");
  });

  it("InstrumentRangeToggle selects ranges", () => {
    const onChange = vi.fn();
    wrap(<InstrumentRangeToggle value="1y" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "1Y" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "6M" }));
    expect(onChange).toHaveBeenCalledWith("6m");
  });
});

describe("InfoTip", () => {
  it("makes a non-interactive child keyboard-reachable and shows the tip on focus", async () => {
    render(
      <InfoTip label="Valued at cost" focusable>
        <span>AT COST</span>
      </InfoTip>,
    );
    const trigger = screen.getByText("AT COST");
    expect(trigger).toHaveAttribute("tabindex", "0");
    fireEvent.focus(trigger);
    await waitFor(() => expect(screen.getAllByText("Valued at cost").length).toBeGreaterThan(0));
  });
});
