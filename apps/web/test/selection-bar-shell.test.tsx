import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { SelectionBarShell } from "../src/components/ui/selection-bar-shell";
import {
  FullScreenOverlayProvider,
  useAnyFullScreenOverlayOpen,
} from "../src/components/full-screen-overlay";

afterEach(cleanup);

function NavProbe() {
  const open = useAnyFullScreenOverlayOpen();
  return <span data-testid="nav-probe">{open ? "hidden" : "visible"}</span>;
}

describe("SelectionBarShell", () => {
  it("renders the label, dismiss button, and actions", () => {
    render(
      <SelectionBarShell label="2 selected" onDismiss={() => {}} dismissLabel="Cancel">
        <button type="button">Delete</button>
      </SelectionBarShell>,
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("omits the actions tray entirely when there are no actions", () => {
    const { container } = render(
      <SelectionBarShell label="Select rows" onDismiss={() => {}} dismissLabel="Cancel" />,
    );
    // Only the label span's flex row, no second (actions) flex row.
    expect(container.querySelectorAll(":scope > div > span")).toHaveLength(1);
  });

  it("carries the mobile fixed-bottom and desktop inline classes on the same element", () => {
    const { container } = render(
      <SelectionBarShell label="Select rows" onDismiss={() => {}} dismissLabel="Cancel" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("max-md:fixed");
    expect(root.className).toContain("max-md:bottom-0");
    expect(root.className).toContain("md:rounded-lg");
    // The undefined `safe-area-bottom` class this replaces must not resurface.
    expect(root.className).not.toContain("safe-area-bottom");
  });

  it("merges a caller className without losing the base geometry", () => {
    const { container } = render(
      <SelectionBarShell
        label="Select rows"
        onDismiss={() => {}}
        dismissLabel="Cancel"
        className="md:mx-6 md:mb-3"
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("md:mx-6");
    expect(root.className).toContain("max-md:fixed");
  });

  it("registers as a full-screen overlay while mounted, hiding BottomNav", () => {
    function Harness({ mounted }: { mounted: boolean }) {
      return (
        <FullScreenOverlayProvider>
          <NavProbe />
          {mounted && (
            <SelectionBarShell label="Select rows" onDismiss={() => {}} dismissLabel="Cancel" />
          )}
        </FullScreenOverlayProvider>
      );
    }
    const { rerender } = render(<Harness mounted={false} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");

    rerender(<Harness mounted={true} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("hidden");

    rerender(<Harness mounted={false} />);
    expect(screen.getByTestId("nav-probe")).toHaveTextContent("visible");
  });
});
