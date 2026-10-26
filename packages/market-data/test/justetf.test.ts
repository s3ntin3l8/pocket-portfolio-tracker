import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JustEtfProvider } from "../src/justetf.js";

describe("JustEtfProvider", () => {
  let provider: JustEtfProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const mockProfilePage = "<html>ETF profile page</html>";
  const mockCookies = ["JSESSIONID=ABC123; Path=/; HttpOnly", "XSRF-TOKEN=xyz; Path=/; HttpOnly"];

  function mockSuccess(xml: string) {
    // First call: profile page with cookies
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: { getSetCookie: () => mockCookies },
      text: () => Promise.resolve(mockProfilePage),
    });
    // Second call: AJAX endpoint with country data
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(xml),
    });
  }

  function mockProfilePageOnly() {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      headers: { getSetCookie: () => mockCookies },
      text: () => Promise.resolve(mockProfilePage),
    });
  }

  beforeEach(() => {
    provider = new JustEtfProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("supports", () => {
    it("returns true for ETFs", () => {
      expect(provider.supports("etf", "XETRA")).toBe(true);
      expect(provider.supports("etf", "NYSE")).toBe(true);
    });

    it("returns false for non-ETFs", () => {
      expect(provider.supports("equity", "XETRA")).toBe(false);
      expect(provider.supports("gold", "XAU")).toBe(false);
      expect(provider.supports("bond", "XETRA")).toBe(false);
    });
  });

  describe("getProfile", () => {
    it("returns null for invalid ISIN", async () => {
      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "INVALID",
      });
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns null for missing ISIN", async () => {
      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
      });
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fetches session then country allocation", async () => {
      const mockXml = `
        <tbody>
          <tr data-testid="etf-holdings_countries_row">
            <td data-testid="tl_etf-holdings_countries_value_name">Germany</td>
            <td data-testid="tl_etf-holdings_countries_value_percentage">39.05%</td>
          </tr>
          <tr data-testid="etf-holdings_countries_row">
            <td data-testid="tl_etf-holdings_countries_value_name">United States</td>
            <td data-testid="tl_etf-holdings_countries_value_percentage">15.23%</td>
          </tr>
          <tr data-testid="etf-holdings_countries_row">
            <td data-testid="tl_etf-holdings_countries_value_name">France</td>
            <td data-testid="tl_etf-holdings_countries_value_percentage">10.50%</td>
          </tr>
        </tbody>
      `;

      mockSuccess(mockXml);

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).not.toBeNull();
      expect(result!.countryWeights).toBeDefined();
      expect(Object.keys(result!.countryWeights!)).toHaveLength(3);
      expect(result!.countryWeights!.Germany).toBeCloseTo(0.3905, 4);
      expect(result!.countryWeights!["United States"]).toBeCloseTo(0.1523, 4);
      expect(result!.countryWeights!.France).toBeCloseTo(0.105, 4);

      // Two fetch calls: profile page + AJAX
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // First call: profile page
      expect(fetchSpy.mock.calls[0][0]).toContain("isin=IE00B4K48X80");
      expect(fetchSpy.mock.calls[0][0]).not.toContain("_wicket=1");

      // Second call: AJAX endpoint
      expect(fetchSpy.mock.calls[1][0]).toContain("_wicket=1");
      expect(fetchSpy.mock.calls[1][0]).toContain("isin=IE00B4K48X80");
      expect(fetchSpy.mock.calls[1][1].headers["X-Requested-With"]).toBe("XMLHttpRequest");
      expect(fetchSpy.mock.calls[1][1].headers["Cookie"]).toContain("JSESSIONID=ABC123");
    });

    it("returns null when profile page fails", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: { getSetCookie: () => [] },
      });

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null when no cookies returned", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        headers: { getSetCookie: () => [] },
        text: () => Promise.resolve(mockProfilePage),
      });

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns null when no countries found", async () => {
      mockProfilePageOnly();
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`<tbody></tbody>`),
      });

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).toBeNull();
    });

    it("returns null on AJAX endpoint failure", async () => {
      mockProfilePageOnly();
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      expect(result).toBeNull();
    });

    it("handles lowercase ISIN", async () => {
      const mockXml = `
        <tbody>
          <tr data-testid="etf-holdings_countries_row">
            <td data-testid="tl_etf-holdings_countries_value_name">Germany</td>
            <td data-testid="tl_etf-holdings_countries_value_percentage">100%</td>
          </tr>
        </tbody>
      `;

      mockSuccess(mockXml);

      const result = await provider.getProfile({
        symbol: "MWOF",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "ie00b4k48x80",
      });

      expect(result).not.toBeNull();
      expect(result!.countryWeights).toBeDefined();
      expect(Object.keys(result!.countryWeights!)).toHaveLength(1);
      expect(result!.countryWeights!.Germany).toBeCloseTo(1, 4);
    });
  });

  describe("rate limiting", () => {
    it("enforces minimum 1 second between requests", async () => {
      const mockXml = `
        <tbody>
          <tr data-testid="etf-holdings_countries_row">
            <td data-testid="tl_etf-holdings_countries_value_name">Germany</td>
            <td data-testid="tl_etf-holdings_countries_value_percentage">100%</td>
          </tr>
        </tbody>
      `;

      // Each call makes 2 requests (page + AJAX)
      fetchSpy.mockResolvedValue({
        ok: true,
        headers: { getSetCookie: () => mockCookies },
        text: () => Promise.resolve(mockXml),
      });

      const start = Date.now();

      await provider.getProfile({
        symbol: "ETF1",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      await provider.getProfile({
        symbol: "ETF2",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        isin: "IE00B4K48X80",
      });

      const elapsed = Date.now() - start;
      // 4 requests total, each with 1s gap = ~3s minimum
      expect(elapsed).toBeGreaterThanOrEqual(2900);
    });
  });
  describe("getHistoryFrom", () => {
    const ref = {
      symbol: "MWOF",
      market: "XETRA",
      assetClass: "etf" as const,
      currency: "EUR",
      isin: "IE000CNSFAR2",
    };

    function mockSeries(series: { date: string; raw: number }[]) {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ series: series.map((p) => ({ date: p.date, value: { raw: p.raw } })) }),
      });
    }

    it("returns weekday closes stamped with the instrument currency, dropping weekend repeats", async () => {
      mockSeries([
        { date: "2026-08-21", raw: 15.84 }, // Fri
        { date: "2026-08-22", raw: 15.84 }, // Sat
        { date: "2026-08-23", raw: 15.84 }, // Sun
        { date: "2026-08-24", raw: 15.85 }, // Mon
      ]);
      const candles = await provider.getHistoryFrom(ref, "2026-08-21");
      expect(candles).toEqual([
        { date: "2026-08-21", close: "15.84", currency: "EUR" },
        { date: "2026-08-24", close: "15.85", currency: "EUR" },
      ]);
      const url = String(fetchSpy.mock.calls[0]![0]);
      expect(url).toContain("/etfs/IE000CNSFAR2/performance-chart");
      expect(url).toContain("currency=EUR");
      expect(url).toContain("dateFrom=2026-08-21");
    });

    it("skips rows before fromDate and non-positive/garbage values", async () => {
      mockSeries([
        { date: "2026-08-20", raw: 15.8 },
        { date: "2026-08-21", raw: 0 },
        { date: "2026-08-24", raw: 15.85 },
      ]);
      const candles = await provider.getHistoryFrom(ref, "2026-08-21");
      expect(candles.map((c) => c.date)).toEqual(["2026-08-24"]);
    });

    it("returns [] without fetching for a non-ETF, a bad ISIN or an unsupported currency", async () => {
      expect(await provider.getHistoryFrom({ ...ref, assetClass: "equity" }, "2026-08-21")).toEqual(
        [],
      );
      expect(await provider.getHistoryFrom({ ...ref, isin: "nope" }, "2026-08-21")).toEqual([]);
      expect(await provider.getHistoryFrom({ ...ref, currency: "IDR" }, "2026-08-21")).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns [] on an HTTP error", async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });
      expect(await provider.getHistoryFrom(ref, "2026-08-21")).toEqual([]);
    });
  });
});
