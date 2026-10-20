import type { Portfolio } from "@portfolio/api-client";

export const CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

export type EditablePortfolio = Pick<
  Portfolio,
  | "id"
  | "name"
  | "baseCurrency"
  | "accountHolderId"
  | "portfolioType"
  | "brokerage"
  | "accountNumber"
  | "iban"
  | "cashCounted"
  | "allowNegativeCash"
  | "documentRetention"
  | "taxAllowanceAnnual"
  | "country"
  | "transactionCount"
> & {
  /** Absent on fixtures and on responses from before the column existed. */
  cryptoTaxVenue?: "domestic" | "foreign" | null;
};

export const NEW_HOLDER = "__new__";
