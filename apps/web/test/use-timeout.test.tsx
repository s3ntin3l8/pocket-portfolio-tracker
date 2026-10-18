import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTimeout } from "@/lib/use-timeout";

describe("useTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the callback after the delay", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useTimeout());
    act(() => result.current.schedule(fn, 1000));
    act(() => vi.advanceTimersByTime(999));
    expect(fn).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("restarts on a second schedule: only the latest callback runs, after its full delay", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useTimeout());
    act(() => result.current.schedule(first, 1000));
    act(() => vi.advanceTimersByTime(700));
    act(() => result.current.schedule(second, 1000));
    act(() => vi.advanceTimersByTime(700));
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("cancel() drops the pending callback", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useTimeout());
    act(() => result.current.schedule(fn, 1000));
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(5000));
    expect(fn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the pending callback on unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useTimeout());
    act(() => result.current.schedule(fn, 1000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps schedule/cancel stable across renders (safe in effect deps)", () => {
    const { result, rerender } = renderHook(() => useTimeout());
    const { schedule, cancel } = result.current;
    rerender();
    expect(result.current.schedule).toBe(schedule);
    expect(result.current.cancel).toBe(cancel);
  });
});
