/** Which Worker a request to the hosted zone belongs to, by its host: a leaf module (XC-100), so the
 * host-to-binding rule is tested in plain node. `hosted/index.ts` may export only its handler and its Durable
 * Object, and hands the request on to what this names. */

/** The zone's other Workers, which this route sits in front of, by the name before the domain. */
const OTHERS = { relay: "RELAY", checkout: "CHECKOUT", www: "SITE" } as const;
export type Other = (typeof OTHERS)[keyof typeof OTHERS];

/** A store's address is random, so agents' links never change when the owner later picks a name. */
export const STORE = /^[a-z2-7]{12}$/;

/** The store a request's host names, if it is one. */
export function storeOf(host: string, domain: string): string | null {
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return null;
  const store = host.slice(0, -suffix.length);
  return STORE.test(store) ? store : null;
}

/** The binding of the zone's other Worker a host names, if it names one. */
export function otherOf(host: string, domain: string): Other | null {
  const other = host.endsWith(`.${domain}`) ? host.slice(0, -domain.length - 1) : "";
  return Object.hasOwn(OTHERS, other) ? OTHERS[other as keyof typeof OTHERS] : null;
}
