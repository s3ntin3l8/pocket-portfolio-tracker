export function emptyInsightsResponse() {
  return {
    drawdown: {
      maxDrawdownPct: "0",
      peakDate: null,
      troughDate: null,
      currentDrawdownPct: "0",
    },
    volatility: { annualizedVolatility: null, sharpeRatio: null, sortinoRatio: null },
    streaks: {
      bestStreak: null,
      worstStreak: null,
      bestMonth: null,
      worstMonth: null,
      bestYear: null,
      worstYear: null,
      positiveMonths: 0,
      negativeMonths: 0,
      totalMonths: 0,
    },
    benchmark: null,
    concentrationTrend: [],
    bestWorstMonthly: { best: null, worst: null },
    bestWorstYearly: { best: null, worst: null },
  } as const;
}
