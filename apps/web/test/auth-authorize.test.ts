import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-secret-1234567890-test-secret-12345"; // pragma: allowlist secret
  process.env.AUTH_LOCAL_SECRET = "local-secret-for-tests-only"; // pragma: allowlist secret
  process.env.API_URL = "http://api.test";
});

vi.mock("next-auth", () => ({ default: vi.fn((config) => config) }));
vi.mock("next-auth/providers/authentik", () => ({ default: vi.fn(() => ({})) }));
// Hand back the provider config itself so the test can call its authorize().
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn((config) => config) }));

import { authConfig } from "../src/auth";

type Authorize = (
  credentials: Record<string, unknown>,
  request?: Request,
) => Promise<{ accessToken?: string } | null>;

const provider = (authConfig.providers as unknown as Array<{ authorize?: Authorize }>).find(
  (p) => typeof p.authorize === "function",
)!;

describe("Credentials authorize", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "u1",
        email: "a@example.com",
        accessToken: "tok",
        expiresAt: 123,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const creds = { email: "a@example.com", password: "pw" }; // pragma: allowlist secret

  it("forwards only the first x-forwarded-for hop to the login endpoint", async () => {
    const request = new Request("http://web.test/api/auth/callback/credentials", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    const user = await provider.authorize!(creds, request);
    expect(user?.accessToken).toBe("tok");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.test/auth/local/login");
    expect(init.headers["x-forwarded-for"]).toBe("203.0.113.7");
  });

  it("omits the header when the request carries none", async () => {
    await provider.authorize!(creds, new Request("http://web.test/x"));
    expect(fetchMock.mock.calls[0]![1].headers["x-forwarded-for"]).toBeUndefined();
  });
});
