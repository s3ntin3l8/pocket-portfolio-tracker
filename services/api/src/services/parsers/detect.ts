/**
 * Sniff which CSV parser a document needs, so the UI can default to "auto" instead of
 * making the user pick. DKB exports are unmistakable: they are `;`-delimited and carry
 * German headers — a depot snapshot starts with `Datum der Erstellung`, a Girokonto
 * Umsatzliste has both `Buchungsdatum` and `Verwendungszweck`); IBKR Flex Trades carry
 * `TradePrice` + `CurrencyPrimary`; Coinbase carries `Quantity Transacted`; a Trade
 * Republic transaction export carries `transaction_id` + `mcc_code` + `counterparty_iban`.
 * Anything else is the generic column CSV.
 */
export type CsvFormat = "generic" | "dkb" | "ibkr" | "coinbase" | "tr-csv";

export function detectCsvFormat(content: string): CsvFormat {
  const stripped = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = stripped.split(/\r?\n/);
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? "";

  if (/^"?Datum der Erstellung"?;/.test(firstNonEmpty)) return "dkb";
  // Trade Republic export — its header is comma-delimited and uniquely combines a
  // transaction_id with card (mcc_code) and SEPA (counterparty_iban) columns.
  if (
    /transaction_id/.test(firstNonEmpty) &&
    /mcc_code/.test(firstNonEmpty) &&
    /counterparty_iban/.test(firstNonEmpty)
  ) {
    return "tr-csv";
  }
  if (lines.some((l) => l.includes("Buchungsdatum") && l.includes("Verwendungszweck"))) {
    return "dkb";
  }
  if (lines.some((l) => /TradePrice/.test(l) && /CurrencyPrimary/.test(l))) {
    return "ibkr";
  }
  if (lines.some((l) => /Quantity Transacted/i.test(l))) return "coinbase";
  return "generic";
}
