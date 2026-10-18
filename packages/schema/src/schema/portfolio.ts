import { z } from "zod";
import { decimalString, currencyCode } from "./primitives.js";
import { countryCode } from "./countries.js";

const portfolioFields = {
  name: z.string().min(1),
  baseCurrency: currencyCode,
  accountHolderId: z.guid().nullable(),
  brokerage: z.string().trim().nullable(),
  accountNumber: z.string().trim().nullable(),
  iban: z.string().trim().nullable(),
  cashCounted: z.boolean(),
  allowNegativeCash: z.boolean(),
  documentRetention: z.boolean(),
  taxAllowanceAnnual: decimalString.nullable(),
  /** Where the account is held (ISO 3166-1 alpha-2), or null when unset. Decides the
   *  Indonesian tax classification of cash interest (docs/tax.md). */
  country: countryCode.nullable(),
};

export const portfolioInputSchema = z.object({
  name: portfolioFields.name,
  baseCurrency: portfolioFields.baseCurrency.default("IDR"),
  accountHolderId: portfolioFields.accountHolderId.optional(),
  brokerage: portfolioFields.brokerage.optional(),
  accountNumber: portfolioFields.accountNumber.optional(),
  iban: portfolioFields.iban.optional(),
  cashCounted: portfolioFields.cashCounted.default(false),
  allowNegativeCash: portfolioFields.allowNegativeCash.default(false),
  documentRetention: portfolioFields.documentRetention.default(false),
  taxAllowanceAnnual: portfolioFields.taxAllowanceAnnual.optional(),
  country: portfolioFields.country.optional(),
});
export type PortfolioInput = z.infer<typeof portfolioInputSchema>;

export const portfolioPatchSchema = z.object(portfolioFields).partial();
export type PortfolioPatch = z.infer<typeof portfolioPatchSchema>;
