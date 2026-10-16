const PATTERN = /^lore_(owner|agent)_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/;
const utf8 = new TextEncoder();

export type Role = "owner" | "agent";

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", utf8.encode(text)));
}

export function sameHash(a: string, b: string): boolean {
  return a.length === b.length && crypto.subtle.timingSafeEqual(utf8.encode(a), utf8.encode(b));
}

/** `lore_<role>_<owner>_<secret>`, contracts/inbox.md "Tokens". */
export class Token {
  constructor(
    readonly role: Role,
    readonly owner: string,
    readonly secret: string
  ) {}

  static mint(role: Role, owner: string): Token {
    return new Token(role, owner, randomSecret());
  }

  static fromRequest(request: Request, role: Role): Token | null {
    const match = PATTERN.exec(request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "");
    return match && match[1] === role ? new Token(role, match[2], match[3]) : null;
  }

  toString(): string {
    return `lore_${this.role}_${this.owner}_${this.secret}`;
  }
}
