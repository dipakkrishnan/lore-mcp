/** What checkout reads from a seller's store before charging: who the piece pays, and how much. */

export const PIECE = /^[0-9a-f]{24}$/;
export const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
/** Cards can't charge less; a store priced below this offers no card checkout. */
export const CARD_MINIMUM_USD = 0.5;

/** What a store says about one piece at /p/<id>.json; only fields its pages already show for free. */
export type Listing = { id: string; teaser: string; price_usd: number; stripe_account: string; test: boolean };

/** A store origin exactly as a store page posts it; plain http only for a store running on this machine. */
export function storeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || local) && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

export async function listing(origin: string, piece: string): Promise<Listing | null> {
  try {
    const response = await fetch(`${origin}/p/${piece}.json`);
    if (!response.ok) return null;
    const found: Listing = await response.json();
    return found.id === piece ? found : null;
  } catch {
    return null;
  }
}

/** A test store takes only a test key's payments. */
export const keyFits = (found: Listing, env: Env) => !found.test || /^[rs]k_test_/.test(env.STRIPE_SECRET_KEY);
