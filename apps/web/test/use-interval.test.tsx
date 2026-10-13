import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, renderHook } from "@testing-library/react";
import { useInterval, usePageVisible } from "../src/lib/use-interval";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  Object.defineProperty(document, "hidden", { value: state === "hidden", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function Probe({
  cb,
  delay,
  opts,
}: {
  cb: () => void | Promise<void>;
  delay: number | null;
  opts?: Parameters<typeof useInterval>[2];
}) {
  useInterval(cb, delay, opts);
  return null;
}

describe("useInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every delay while visible", async () => {
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(3500));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("is disabled with a null delay", async () => {
    const cb = vi.fn();
    render(<Probe cb={cb} delay={null} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(cb).not.toHaveBeenCalled();
  });

  it("pauses while the document is hidden and resumes when shown again", async () => {
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(cb).toHaveBeenCalledTimes(1); // nothing while hidden

    setVisibility("visible");
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(cb).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("can tick immediately on resume", async () => {
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} opts={{ tickOnResume: true }} />);
    setVisibility("hidden");
    setVisibility("visible");
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not start ticking if mounted while hidden, until shown", async () => {
    setVisibility("hidden");
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(cb).not.toHaveBeenCalled();
    setVisibility("visible");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("keeps ticking while hidden with runWhenHidden", async () => {
    setVisibility("hidden");
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} opts={{ runWhenHidden: true }} />);
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("honours initialDelayMs for the first tick only", async () => {
    const cb = vi.fn();
    render(<Probe cb={cb} delay={1000} opts={{ initialDelayMs: 200 }} />);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(cb).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(cb).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("never overlaps ticks: the next is scheduled after the async callback settles", async () => {
    let release!: () => void;
    const cb = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<Probe cb={cb} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(cb).toHaveBeenCalledTimes(1); // still in flight
    await act(async () => release());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("survives a throwing tick, always calls the latest callback, and stops on unmount", async () => {
    const first = vi.fn(() => {
      throw new Error("boom");
    });
    const second = vi.fn();
    const { rerender, unmount } = render(<Probe cb={first} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(first).toHaveBeenCalledTimes(1);

    rerender(<Probe cb={second} delay={1000} />);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("usePageVisible", () => {
  it("tracks document.visibilityState", () => {
    setVisibility("visible");
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);
    setVisibility("hidden");
    expect(result.current).toBe(false);
    setVisibility("visible");
    expect(result.current).toBe(true);
  });
});
