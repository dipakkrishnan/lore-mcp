/** The owner's pushed settings, read from `node_settings` rows: a leaf module (XC-100), so the rules for
 * what each row means are tested without a database. `readAnswerSettings` (answer-state.ts) runs the query. */

export interface AnswerSettings {
  enabled: boolean;
  priceUsd: number;
  proxy: string;
  listedName: string;
  /** The seller's Stripe connected account; empty when the store takes no cards. */
  stripeAccount: string;
  /** Copies of each piece given away before it costs anything (MON-040); none unless the owner's push set it. */
  freeCopies: number;
  /** Where buyers write for help or a refund; empty shows no support line. */
  supportEmail: string;
  /** The price of a piece as the owner last pushed it; 0 until a push carries one, and the deployed price applies. */
  publicationPriceUsd: number;
  /** False while the owner has the store online only for their agents (XC-069). A store whose push
   * predates the setting sells, as it always did. */
  selling: boolean;
}

/** A store whose settings can't be read sells nothing until they can (XC-069): fail closed. */
export const CLOSED: AnswerSettings = {
  enabled: false,
  priceUsd: 0,
  proxy: "",
  listedName: "",
  stripeAccount: "",
  freeCopies: 0,
  supportEmail: "",
  publicationPriceUsd: 0,
  selling: false
};

/** What the owner's `node_settings` rows say, with a missing or malformed value read as unset. */
export function parseSettings(rows: { key: string; value: string }[]): AnswerSettings {
  const values = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const priceUsd = Number(values.answer_price_usd ?? 0);
  const proxy = values.proxy_preamble ?? "";
  const freeCopies = Number(values.free_copies ?? 0);
  const publicationPriceUsd = Number(values.price_usd ?? 0);
  const enabled =
    values.answer_enabled === "true" && proxy.trim() !== "" && Number.isFinite(priceUsd) && priceUsd > 0;
  return {
    enabled,
    priceUsd,
    proxy,
    listedName: values.listed_name ?? "",
    stripeAccount: values.stripe_account ?? "",
    freeCopies: Number.isInteger(freeCopies) && freeCopies > 0 ? freeCopies : 0,
    supportEmail: values.support_email ?? "",
    publicationPriceUsd: Number.isFinite(publicationPriceUsd) && publicationPriceUsd > 0 ? publicationPriceUsd : 0,
    selling: values.selling !== "false"
  };
}
