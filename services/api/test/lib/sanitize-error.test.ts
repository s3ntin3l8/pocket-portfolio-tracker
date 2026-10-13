import { describe, it, expect } from "vitest";
import { oneLine, sanitizeConnectionError } from "../../src/lib/sanitize-error.js";
import { PytrAuthError, PytrError } from "../../src/services/pytr/errors.js";

describe("sanitizeConnectionError (A8)", () => {
  it("never persists raw pytr stderr", () => {
    const stderr =
      'Traceback (most recent call last):\n  File "/opt/pytr/x.py", line 3\nValueError: phone +4915123456789 rejected';
    const out = sanitizeConnectionError(new PytrError(stderr));
    expect(out).toBe("pytr failed (see server logs)");
    expect(out).not.toContain("Traceback");
    expect(out).not.toContain("4915");
  });

  it("maps known classes to stable messages", () => {
    expect(sanitizeConnectionError(new PytrAuthError())).toBe("Trade Republic session expired");
    expect(sanitizeConnectionError(new PytrError("pytr process timed out"))).toBe(
      "pytr process timed out",
    );
  });

  it("reduces other errors to one redacted, capped line", () => {
    const out = sanitizeConnectionError(
      new Error(
        `boom at https://x.example/a?token=abc\n  at /srv/app/file.js:1\n${"x".repeat(500)}`,
      ),
    );
    expect(out).not.toContain("\n");
    expect(out).not.toContain("https://");
    expect(out.length).toBeLessThanOrEqual(140);
    expect(oneLine("a".repeat(30))).toBe("[redacted]");
    // Short numeric ids stay readable; long digit runs (phone-like) are hidden.
    expect(oneLine("pool 123456 closed")).toBe("pool 123456 closed");
    expect(oneLine("rejected 4915123456789")).toBe("rejected [redacted]");
    expect(sanitizeConnectionError("not an error", "fallback")).toBe("fallback");
  });
});
