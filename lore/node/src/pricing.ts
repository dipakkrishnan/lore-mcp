/** What the storefront sells and for how much, and whether a card receipt paid for it: a leaf module (XC-100),
 * so the rules are tested in plain node. `index.ts` reads the settings, the catalog and checkout's answer, and
 * hands them here. */
import type { Catalog } from "./answer-state.js";
import type { Collection } from "./collections.js";
import { TESTNET, network } from "./network.js";
import { PRICE_USD } from "./price.js";
import type { AnswerSettings } from "./settings.js";
import { type Piece, type Store, pieces } from "./storefront.js";
import { takesAgentPayments } from "./wallet.js";

/** Cards can't charge less, so a store priced below this offers no card checkout. */
export const CARD_MINIMUM_USD = 0.5;
export const STRIPE_ACCOUNT = /^acct_[A-Za-z0-9]+$/;
/** A Checkout Session, or a bid's direct charge (MON-054); checkout verifies either. */
export const SESSION = /^(cs|pi)_[A-Za-z0-9_]+$/;

/** What a piece costs: the owner's pushed price, so a new price needs no redeploy; the deployed one until a push carries it. */
export const priceOf = (settings: AnswerSettings) => settings.publicationPriceUsd || PRICE_USD;

/** Whether a card can buy something at this price here: the owner connected a Stripe account, and cards can charge it. */
export const takesCards = (settings: AnswerSettings, priceUsd: number) =>
  STRIPE_ACCOUNT.test(settings.stripeAccount) && priceUsd >= CARD_MINIMUM_USD;

/** The store a page renders: its name, price, network, and the ways it can be paid. */
export function storeFor(env: Env, origin: string, settings: AnswerSettings, priceUsd = priceOf(settings)): Store {
  return {
    name: settings.listedName,
    priceUsd,
    origin,
    test: network(env) === TESTNET,
    freeCopies: settings.freeCopies,
    support: settings.supportEmail,
    selling: settings.selling,
    agentsPay: takesAgentPayments(env),
    ...(settings.selling && takesCards(settings, priceUsd) ? { checkout: env.CHECKOUT_URL } : {})
  };
}

/** What an id names in this store: a piece in the catalog, else a collection with the pieces of it still listed. */
export type Found = { piece: Piece } | { set: Collection; entries: Piece[] };

export function findItem(catalog: Catalog, sets: Collection[], id: string): Found | undefined {
  const all = pieces(catalog);
  const piece = all.find((candidate) => candidate.id === id);
  if (piece) return { piece };
  const set = sets.find((candidate) => candidate.id === id);
  if (!set) return undefined;
  return { set, entries: set.pieces.flatMap((member) => all.filter((candidate) => candidate.id === member)) };
}

/** What Lore's checkout says about a session it was asked to verify. */
export type Receipt = { paid: boolean; piece?: string; origin?: string; payment_intent?: string; amount_usd?: number };
export type Paid = { tx: string; priceUsd: number };

/** Whether a session and account are worth asking checkout about at all. */
export const verifiable = (session: string, account: string) => SESSION.test(session) && STRIPE_ACCOUNT.test(account);

/** A receipt pays for this item only if it is paid, names this item and this store, and carries its payment. */
export function paidBy(receipt: Receipt, id: string, origin: string): Paid | null {
  const tx = receipt.payment_intent ?? "";
  const matches = receipt.paid && receipt.piece === id && receipt.origin === origin && tx;
  return matches ? { tx, priceUsd: receipt.amount_usd ?? 0 } : null;
}
