/** The storefront's routes and the free-copy cookie, a leaf module (XC-100): the rules the Worker's fetch
 * reads off a request's path and headers, kept apart from `index.ts`, which may export only its handler
 * and its Durable Object. */

/** A storefront page's path: the store at `/`, a piece or collection at `/p/<id>`, its checkout listing at
 * `/p/<id>.json`, or a receipt at `/p/<id>/`. A `/p/...` path that names no id is still a page, a not-found one. */
export type PageRoute = { id?: string; format?: ".json" | "/" };

const PAGE = /^\/p(\/|$)/;
const ITEM = /^\/p\/([0-9a-f]{24})(\.json|\/)?$/;
const POSTED = /^\/p\/([0-9a-f]{24})\/(paid|free)$/;
const FREE_COOKIE = /(?:^|;\s*)lore_free=(free_[0-9a-f]{32})/;
/** A year: a reader keeps their free copy as long as a card receipt. */
const FREE_COOKIE_SECONDS = 31_536_000;

/** The page a path names, or null when the path is not a storefront page. */
export function pageRoute(pathname: string): PageRoute | null {
  if (pathname !== "/" && !PAGE.test(pathname)) return null;
  const [, id, format] = pathname.match(ITEM) ?? [];
  return { ...(id ? { id } : {}), ...(format ? { format: format as PageRoute["format"] } : {}) };
}

/** What a POST to `/p/<id>/paid` (checkout's notice) or `/p/<id>/free` (a reader taking a free copy) names. */
export function postRoute(pathname: string): { id: string; action: "paid" | "free" } | null {
  const [, id, action] = pathname.match(POSTED) ?? [];
  return id ? { id, action: action as "paid" | "free" } : null;
}

/** The free-copy link a browser already holds, from its `cookie` header. */
export function freeCookie(header: string | null): string | undefined {
  return header?.match(FREE_COOKIE)?.[1];
}

/** The cookie that sends a browser back to its free copy, scoped to that piece's page. */
export function freeCookieHeader(link: string, id: string): string {
  return `lore_free=${link}; Path=/p/${id}; Max-Age=${FREE_COOKIE_SECONDS}; Secure; HttpOnly; SameSite=Lax`;
}
