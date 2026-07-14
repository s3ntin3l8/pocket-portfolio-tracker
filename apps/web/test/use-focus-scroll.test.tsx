import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React, { useRef } from "react";
import { useFocusScroll } from "../src/lib/use-focus-scroll";

function TestComponent() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusScroll(ref);
  return (
    <div ref={ref}>
      <input data-testid="input" />
    </div>
  );
}

describe("useFocusScroll", () => {
  it("scrolls focused input into view on focusin", () => {
    const scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { getByTestId } = render(<TestComponent />);
    const input = getByTestId("input");

    // Trigger focusin event
    fireEvent.focusIn(input);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
  });
});
