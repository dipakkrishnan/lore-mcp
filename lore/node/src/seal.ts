/** Sealing for the agent inbox (XC-067, contracts/inbox.md "Sealing"). Only the owner's Mac can open what this seals. */

const INFO = new TextEncoder().encode("lore-inbox-v1");
const utf8 = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** HKDF-SHA256 over X25519(private, peer), salted with eph.public || owner_public. */
export async function sealingKey(privateKey: CryptoKey, peer: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const publicKey = await crypto.subtle.importKey("raw", peer, { name: "X25519" }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);
  const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: INFO }, ikm, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
}

/** b64url(eph.public || nonce || AES-256-GCM(key, nonce, plaintext, aad=item_id)). */
export async function seal(
  ownerPublic: Uint8Array<ArrayBuffer>,
  itemId: string,
  plaintext: string,
  ephemeral?: CryptoKeyPair,
  nonce = crypto.getRandomValues(new Uint8Array(12))
): Promise<string> {
  const eph = ephemeral ?? (await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]));
  const ephPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const key = await sealingKey(eph.privateKey, ownerPublic, new Uint8Array([...ephPublic, ...ownerPublic]));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8.encode(itemId) }, key, utf8.encode(plaintext));
  return b64url(new Uint8Array([...ephPublic, ...nonce, ...new Uint8Array(ciphertext)]));
}
