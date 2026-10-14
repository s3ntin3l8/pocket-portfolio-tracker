import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/copy";

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
const setExec = (fn: unknown) =>
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });

afterEach(() => {
  setClipboard(undefined);
  setExec(undefined);
  document.body.innerHTML = "";
});

describe("copyToClipboard", () => {
  it("uses the async Clipboard API when it exists", async () => {
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    expect(await copyToClipboard("secret")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("secret");
  });

  it("falls back to a hidden textarea + execCommand over plain HTTP (no clipboard API)", async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    setExec(exec);
    expect(await copyToClipboard("secret")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
  });

  it("falls back when the async API rejects (e.g. permission denied)", async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error("denied"))) });
    setExec(vi.fn(() => true));
    expect(await copyToClipboard("x")).toBe(true);
  });

  it("returns false when both paths fail", async () => {
    setClipboard(undefined);
    setExec(
      vi.fn(() => {
        throw new Error("nope");
      }),
    );
    expect(await copyToClipboard("x")).toBe(false);
    setExec(vi.fn(() => false));
    expect(await copyToClipboard("x")).toBe(false);
  });
});
