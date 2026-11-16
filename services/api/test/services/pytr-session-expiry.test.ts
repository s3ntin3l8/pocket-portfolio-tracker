import { describe, it, expect } from "vitest";
import {
  RENEW_BANNER_WINDOW_MS,
  RENEW_NOTIFY_WINDOW_MS,
  sessionExpiresAt,
} from "../../src/services/pytr/session-expiry.js";

const jwt = (payload: unknown) =>
  `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  ).toString("base64url")}.sig`;

// Mozilla cookie-jar line: domain, subdomains, path, secure, expiry, name, value.
const cookie = (name: string, value: string, httpOnly = false) =>
  `${httpOnly ? "#HttpOnly_" : ""}api.traderepublic.com\tFALSE\t/api\tTRUE\t0\t${name}\t${value}`;

const JAR_HEADER = "# Netscape HTTP Cookie File\n";

describe("sessionExpiresAt", () => {
  it("reads exp from the tr_refresh token (HttpOnly or not) and ignores other cookies", () => {
    const exp = 1_800_000_000;
    const jar =
      JAR_HEADER +
      [
        cookie("tr_session", jwt({ exp: 1_700_000_000 }), true),
        cookie("tr_refresh", jwt({ exp, sub: "someone", sessionId: "x" }), true),
        cookie("tr_device", "opaque"),
      ].join("\n");
    expect(sessionExpiresAt(jar)?.getTime()).toBe(exp * 1000);
    expect(sessionExpiresAt(jar.replace("#HttpOnly_", ""))?.getTime()).toBe(exp * 1000);
  });

  it("is null when there is no refresh cookie, or it is not a usable JWT", () => {
    expect(sessionExpiresAt("")).toBeNull();
    expect(sessionExpiresAt(JAR_HEADER + cookie("tr_session", jwt({ exp: 1_800_000_000 })))).toBe(
      null,
    );
    for (const bad of [
      "opaque-value",
      "a.b",
      jwt("not json"),
      jwt({}),
      jwt({ exp: "soon" }),
      jwt({ exp: -5 }),
      jwt({ exp: null }),
    ]) {
      expect(sessionExpiresAt(JAR_HEADER + cookie("tr_refresh", bad)), String(bad)).toBeNull();
    }
  });

  it("skips an unreadable refresh cookie and uses a later readable one", () => {
    const jar = [cookie("tr_refresh", "opaque"), cookie("tr_refresh", jwt({ exp: 1_900_000_000 }))];
    expect(sessionExpiresAt(jar.join("\n"))?.getTime()).toBe(1_900_000_000_000);
  });

  it("keeps the notification window inside the banner window", () => {
    expect(RENEW_NOTIFY_WINDOW_MS).toBeLessThan(RENEW_BANNER_WINDOW_MS);
  });
});
