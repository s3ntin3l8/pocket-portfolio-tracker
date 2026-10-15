/** Shared by the MCP `pocket://glossary` resource and the chat system prompt. */
export const GLOSSARY = `# Pocket glossary

- **Amounts are decimal strings** with an explicit currency. Quote them as given; never recompute.
- **Never calculate returns yourself.** Every figure comes from a tool. If a figure is missing, say so.
- **Gain has two bases — always name which one:**
  - "vs cost of holdings": unrealized = market value of open holdings minus their cost.
  - "vs net contributed": value minus net external capital that crossed the portfolio's boundary.
- **Cash boundary (cashCounted):** savings-style portfolios count cash inside (contribution = deposits − withdrawals).
  Invest-only portfolios count cash outside (contribution = net invested capital; cash excluded from value).
- **valuedAtCost:** a holding with no usable price is shown at its cost, so it has no measured gain. Say so.
- **fxMissingCurrencies:** amounts in these currencies are excluded from totals (no FX rate). Disclose it.
- **Income** (dividends, interest, coupons) is return, never contribution.
- **transfer_in / transfer_out** move shares between depots at carried cost; they are not sales and carry no P&L.
- **Freistellungsauftrag (FSA)** is allocated per depot; the legal cap lives on the account holder.
- For what a German tax term means (Vorabpauschale, Teilfreistellung, …) use explain_tax_concept; the user's own figures come from get_tax_summary.
- Explanations only — this is not financial or tax advice.
`;
