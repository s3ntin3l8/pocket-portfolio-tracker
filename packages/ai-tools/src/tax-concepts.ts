/**
 * Reviewed, static explanations of the German tax concepts Pocket models, condensed from
 * docs/tax.md. Deliberately free of live rates and user figures (this package has no
 * @portfolio/core dependency): the Basiszins per year, a user's accrued or estimated
 * Vorabpauschale, their Teilfreistellung rates and their allowance usage come from
 * `get_tax_summary`. Explanations only, never tax advice.
 */
export const TAX_CONCEPTS = [
  "vorabpauschale",
  "teilfreistellung",
  "basiszins",
  "fsa",
  "sparerpauschbetrag",
  "loss_pots",
] as const;

export type TaxConcept = (typeof TAX_CONCEPTS)[number];

export interface TaxConceptText {
  title: string;
  summary: string;
  details: string[];
  /** Where the user's own numbers for this concept live. */
  userFigures: string;
}

export const TAX_CONCEPT_TEXT: Record<TaxConcept, TaxConceptText> = {
  vorabpauschale: {
    title: "Vorabpauschale (advance lump-sum fund tax, section 18 InvStG)",
    summary:
      "An advance tax base on accumulating or low-distributing funds (ETFs, mutual funds), deemed received " +
      "on the first working day of the following year, even though no cash was paid out.",
    details: [
      "Per unit, the base is the value at the start of the year times the Basiszins times 70 percent, capped " +
        "at the fund's actual increase in the year (including distributions), minus distributions already paid, never below zero.",
      "In the year of purchase it is reduced by one twelfth for every full month before the purchase month.",
      "Only units still held at 31 December count; units sold during the year get none.",
      "It is reduced by the Teilfreistellung and then counts against the Sparerpauschbetrag like other income.",
      "When the fund is later sold, the Vorabpauschale already taxed is credited so the same amount is not taxed twice.",
      "If the broker books no Vorabpauschale for a completed year, Pocket derives an estimate from year-start and " +
        "year-end prices and labels it as estimated. A broker figure always replaces the estimate. If a price or " +
        "Basiszins is missing there is no estimate, never a guessed one.",
    ],
    userFigures:
      "get_tax_summary returns the accrued and credited Vorabpauschale and whether it is estimated.",
  },
  teilfreistellung: {
    title: "Teilfreistellung (partial exemption for funds)",
    summary:
      "A fixed share of fund gains, distributions and the Vorabpauschale is tax-exempt, so only the remainder " +
      "counts against the allowance and is taxed.",
    details: [
      "The exempt share depends on the fund type. Pocket defaults to 30 percent for ETFs and 15 percent for " +
        "mutual funds and 0 percent otherwise, as a fallback only.",
      "Other fund types have different statutory shares (for example real-estate or mixed funds), so an admin can " +
        "set a per-instrument rate that overrides the default.",
      "Worked example: a closed equity-ETF trade with a gain of 1,000 and a 30 percent Teilfreistellung counts as 700 " +
        "against the allowance.",
      "Gold and crypto have no Teilfreistellung and are outside the allowance pots (private-sale rules apply).",
    ],
    userFigures:
      "get_tax_summary lists the Teilfreistellung rate applied per instrument (tfRatesByInstrument).",
  },
  basiszins: {
    title: "Basiszins (base interest rate for the Vorabpauschale)",
    summary:
      "The yearly reference rate used to compute the Vorabpauschale (section 18 para 4 InvStG), derived from " +
      "federal-bond yields at the first trading day of the year and published by the German Federal Ministry of Finance.",
    details: [
      "It changes every year; in a year with a very low rate the Vorabpauschale can be zero.",
      "This tool does not quote a rate: look the year up in the official BMF letter, or read the resulting " +
        "Vorabpauschale from get_tax_summary.",
      "Pocket never guesses it: a year without a known Basiszins produces no estimated Vorabpauschale.",
    ],
    userFigures:
      "get_tax_summary shows the resulting Vorabpauschale; the rate itself is not exposed to this tool.",
  },
  fsa: {
    title: "Freistellungsauftrag (FSA, exemption order)",
    summary:
      "The instruction you give a broker or bank to withhold no tax on investment income up to a stated amount.",
    details: [
      "It is allocated per depot (broker), while the legal limit belongs to the person: the Sparerpauschbetrag.",
      "Allocations across a person's depots should add up to at most that limit. Pocket warns about " +
        "over-allocation but nothing blocks it; the year-end tax return reconciles the difference.",
      "A depot with no FSA configured cannot have its German tax computed in Pocket.",
      "Changing an FSA is done in Pocket's Settings (the depot's tax allowance) and, separately, with the broker.",
    ],
    userFigures:
      "get_fsa_allocation shows each depot's allocation, usage and remaining headroom; get_tax_summary shows the details.",
  },
  sparerpauschbetrag: {
    title: "Sparerpauschbetrag (saver's allowance, section 20 para 9 EStG)",
    summary:
      "The annual tax-free allowance for capital income per person: 1,000 for a single person and 2,000 for a " +
      "jointly assessed couple (the statutory amounts at the time of writing; Pocket stores the configured value per holder).",
    details: [
      "Realized gains, dividends, interest, coupons and the Vorabpauschale (after Teilfreistellung) are used up against it first.",
      "Only what exceeds the allowance is taxed, at the flat Abgeltungsteuer (25 percent plus 5.5 percent solidarity " +
        "surcharge on it, plus church tax if applicable, unless a rate is set explicitly for the holder).",
      "It is a per-person cap that you distribute across depots with Freistellungsauftraege (see the fsa concept).",
    ],
    userFigures:
      "get_tax_summary shows allowance used, remaining and the estimated tax per holder and depot.",
  },
  loss_pots: {
    title: "Verlustverrechnungstoepfe (loss pots)",
    summary:
      "Realized losses are netted in two pots before the allowance applies, and netting only goes one way.",
    details: [
      "Aktienverlusttopf (stock pot): gains and losses from selling individual shares only.",
      "Allgemeiner Verlusttopf (general pot): fund, bond and derivative gains and losses, plus dividend, interest, " +
        "coupon income and the Vorabpauschale.",
      "A loss in the general pot can offset stock gains. A loss in the stock pot can only offset stock gains, never general income.",
      "A loss that cannot be used is carried forward within its own pot (from the prior year's tax certificate).",
      "Gold and crypto are excluded from both pots.",
    ],
    userFigures: "get_tax_summary shows both pots, carry-forwards and the allowance used.",
  },
};

export function regimeCaveat(regime: "DE" | "ID" | null): string | null {
  if (regime === "DE") return null;
  if (regime === "ID") {
    return (
      "This applies to the German tax regime only. Your portfolios use the Indonesian final-tax regime, " +
      "fixed final rates on gross sale proceeds and on each type of investment income, with no allowance or " +
      "loss-netting, so none of this applies " +
      "to your own numbers; explain it only as background."
    );
  }
  return (
    "This applies to the German tax regime only; your tax regime could not be determined, so check that it " +
    "applies to you before relying on it."
  );
}
