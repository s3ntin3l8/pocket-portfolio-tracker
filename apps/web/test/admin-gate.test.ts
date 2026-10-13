import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@portfolio/api-client";

const h = vi.hoisted(() => ({
  api: {} as object | null,
  me: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/lib/server-api/_shared", () => ({
  getServerApi: async () => h.api,
  meCached: h.me,
}));

import { requireAdmin, loadMeResult } from "@/lib/server-api/user";

describe("admin gate", () => {
  beforeEach(() => {
    h.api = {};
    h.me.mockReset();
    h.notFound.mockClear();
  });

  it("a 429 on the me lookup is rate_limited with its countdown, not notFound", async () => {
    h.me.mockRejectedValue(new ApiError(429, "rate_limited", "7"));
    await expect(requireAdmin()).resolves.toEqual({ status: "rate_limited", retryAfter: 7 });
    expect(h.notFound).not.toHaveBeenCalled();
  });

  it("a 5xx is unavailable, not notFound", async () => {
    h.me.mockRejectedValue(new ApiError(503, "down"));
    await expect(requireAdmin()).resolves.toEqual({ status: "unavailable" });
    expect(h.notFound).not.toHaveBeenCalled();
  });

  it("a 401 / missing API client is unauthorized, not notFound", async () => {
    h.me.mockRejectedValue(new ApiError(401, "nope"));
    await expect(requireAdmin()).resolves.toEqual({ status: "unauthorized" });
    h.api = null;
    await expect(loadMeResult()).resolves.toEqual({ status: "unauthorized" });
    expect(h.notFound).not.toHaveBeenCalled();
  });

  it("a successful non-admin answer is notFound", async () => {
    h.me.mockResolvedValue({ id: "u", isAdmin: false });
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.notFound).toHaveBeenCalledOnce();
  });

  it("an admin passes", async () => {
    h.me.mockResolvedValue({ id: "u", isAdmin: true });
    await expect(requireAdmin()).resolves.toMatchObject({ status: "ok" });
    expect(h.notFound).not.toHaveBeenCalled();
  });
});
