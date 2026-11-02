// Reading what a buyer or the owner sent, into checked fields or one plain sentence saying what to fix.
import { callbackAllowed } from "./bid-callback.js";

export const USD_MIN = 5;
export const USD_MAX = 1000;
const QUESTION_MIN = 10;
const QUESTION_MAX = 280;
const PREVIEW_MAX = 500;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,38}$/i;

const text = (value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
const length = (value) => [...value].length;
const dollars = (value) => {
  const typed = text(value).replace(/^\$/, "").replace(/,/g, "");
  return /^\d{1,7}$/.test(typed) ? Number(typed) : /^\d*\.\d+$/.test(typed) ? Number.NaN : null;
};
const https = (value) => {
  try {
    return new URL(value).protocol === "https:" && value.length <= 2048;
  } catch {
    return false;
  }
};

function amount(value, min, range) {
  const usd = dollars(value);
  if (Number.isNaN(usd)) return { error: "Write the amount in whole dollars, like 20." };
  if (usd === null || usd < min || usd > USD_MAX) return { error: range };
  return { usd_cents: usd * 100 };
}

/** A new bid. `markets` is the set of registry market ids; any other market files under "unsorted". */
export function readBid(fields, markets) {
  const question = text(fields.question).replace(/\s+/g, " ");
  if (length(question) < QUESTION_MIN) return { error: "Write a question of at least 10 characters." };
  if (length(question) > QUESTION_MAX) return { error: "Keep the question to 280 characters or fewer." };
  const price = amount(fields.usd, USD_MIN, "Bids are $5 to $1,000.");
  if (price.error) return price;
  const email = text(fields.email);
  if (email && (email.length > 254 || !EMAIL.test(email))) return { error: "That email address doesn't look right." };
  const callback = text(fields.callback_url);
  if (callback && !https(callback)) return { error: "The callback address has to start with https://." };
  if (callback && !callbackAllowed(callback)) return { error: "The callback address can't be on yourlore.dev." };
  const market = text(fields.market);
  return { value: { question, usd_cents: price.usd_cents, market: markets.has(market) ? market : "unsorted", email: email || null, callback_url: callback || null } };
}

/** A seller's answer, added by the owner while answers are placed by hand (MON-055). */
export function readAnswer(fields) {
  const handle = text(fields.handle).replace(/^@/, "");
  if (!HANDLE.test(handle)) return { error: "Give the seller's handle, like dipak." };
  const piece_url = text(fields.piece_url);
  if (!https(piece_url)) return { error: "The piece's address has to start with https://." };
  const preview = text(fields.preview);
  if (!preview) return { error: "Add the first lines of the answer." };
  if (length(preview) > PREVIEW_MAX) return { error: "Keep the preview to 500 characters or fewer." };
  const price = amount(fields.usd, 1, "Answers are $1 to $1,000.");
  if (price.error) return price;
  return { value: { handle, piece_url, preview, usd_cents: price.usd_cents } };
}
