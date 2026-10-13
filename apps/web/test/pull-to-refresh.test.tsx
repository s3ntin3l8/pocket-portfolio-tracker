import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React, { createRef } from "react";
import { PullToRefresh } from "../src/components/pull-to-refresh";

const mockRefresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

describe("PullToRefresh", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  it("renders children successfully", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    const { getByText } = render(
      <div ref={scrollContainerRef}>
        <PullToRefresh scrollContainerRef={scrollContainerRef}>
          <div>content to refresh</div>
        </PullToRefresh>
      </div>,
    );

    expect(getByText("content to refresh")).toBeInTheDocument();
  });

  it("triggers router.refresh() when pulled down past TRIGGER_HEIGHT", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    render(
      <div ref={scrollContainerRef} style={{ height: "400px", overflowY: "auto" }}>
        <PullToRefresh scrollContainerRef={scrollContainerRef}>
          <div>content to refresh</div>
        </PullToRefresh>
      </div>,
    );

    const container = scrollContainerRef.current!;
    Object.defineProperty(container, "scrollTop", { value: 0, writable: true });

    // Simulate touchstart at clientY: 100
    fireEvent.touchStart(container, {
      touches: [{ clientY: 100 }],
    });

    // Simulate touchmove to clientY: 300 (dy = 200, pullDistance = Math.min(100, 200 * 0.45) = 90)
    // 90px > TRIGGER_HEIGHT (65px)
    fireEvent.touchMove(container, {
      touches: [{ clientY: 300 }],
    });

    // Simulate touchend
    fireEvent.touchEnd(container);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not trigger router.refresh() when pulled down below TRIGGER_HEIGHT", () => {
    const scrollContainerRef = createRef<HTMLDivElement>();
    render(
      <div ref={scrollContainerRef} style={{ height: "400px", overflowY: "auto" }}>
        <PullToRefresh scrollContainerRef={scrollContainerRef}>
          <div>content to refresh</div>
        </PullToRefresh>
      </div>,
    );

    const container = scrollContainerRef.current!;
    Object.defineProperty(container, "scrollTop", { value: 0, writable: true });

    // Simulate touchstart at clientY: 100
    fireEvent.touchStart(container, {
      touches: [{ clientY: 100 }],
    });

    // Simulate touchmove to clientY: 200 (dy = 100, pullDistance = Math.min(100, 100 * 0.45) = 45)
    // 45px < TRIGGER_HEIGHT (65px)
    fireEvent.touchMove(container, {
      touches: [{ clientY: 200 }],
    });

    // Simulate touchend
    fireEvent.touchEnd(container);

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  function setup() {
    const scrollContainerRef = createRef<HTMLDivElement>();
    render(
      <div ref={scrollContainerRef} style={{ height: "400px", overflowY: "auto" }}>
        <PullToRefresh scrollContainerRef={scrollContainerRef}>
          <div>content to refresh</div>
        </PullToRefresh>
      </div>,
    );
    const container = scrollContainerRef.current!;
    Object.defineProperty(container, "scrollTop", { value: 0, writable: true });
    return container;
  }

  it("does not refresh when pulled past the threshold and then dragged back up to the start before release", () => {
    const container = setup();
    fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] }); // 90px, past 65
    fireEvent.touchMove(container, { touches: [{ clientY: 90 }] }); // back above the start
    fireEvent.touchEnd(container);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does not refresh when released after pulling back under the threshold", () => {
    const container = setup();
    fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] }); // 90px
    fireEvent.touchMove(container, { touches: [{ clientY: 180 }] }); // 36px
    fireEvent.touchEnd(container);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("abandons the pull on touchcancel without refreshing, and a stray touchend afterwards is inert", () => {
    const container = setup();
    fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] }); // past threshold
    fireEvent.touchCancel(container);
    fireEvent.touchEnd(container);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("can pull-to-refresh again after a cancelled gesture", () => {
    const container = setup();
    fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] });
    fireEvent.touchCancel(container);

    fireEvent.touchStart(container, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(container, { touches: [{ clientY: 300 }] });
    fireEvent.touchEnd(container);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
