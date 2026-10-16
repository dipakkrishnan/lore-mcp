import { describe, expect, it } from "vitest";
import vector from "../../contracts/inbox_seal_vector.json";
import { seal } from "../src/seal";
import { b64url, fromB64url } from "../src/token";
import { open } from "./helpers";

const PKCS8_X25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);

async function privateKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", new Uint8Array([...PKCS8_X25519, ...fromB64url(raw)]), { name: "X25519" }, true, ["deriveBits"]);
}

async function pair(raw: string): Promise<CryptoKeyPair> {
  const key = await privateKey(raw);
  const { x } = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  const publicKey = await crypto.subtle.importKey("raw", fromB64url(x!), { name: "X25519" }, true, []);
  return { privateKey: key, publicKey };
}

describe("the sealing vector", () => {
  it("opens with the owner's private key", async () => {
    const plain = await open(await privateKey(vector.owner_private), fromB64url(vector.owner_public), vector.item_id, vector.sealed);
    expect(plain).toEqual(JSON.parse(vector.plaintext));
  });

  it("reproduces the sealed bytes from the fixed ephemeral key and nonce", async () => {
    const ownerPublic = (await pair(vector.owner_private)).publicKey;
    expect(b64url(new Uint8Array((await crypto.subtle.exportKey("raw", ownerPublic)) as ArrayBuffer))).toBe(vector.owner_public);
    const sealed = await seal(fromB64url(vector.owner_public), vector.item_id, vector.plaintext, await pair(vector.ephemeral_private), fromB64url(vector.nonce));
    expect(sealed).toBe(vector.sealed);
  });

  it("does not open under another item id", async () => {
    await expect(open(await privateKey(vector.owner_private), fromB64url(vector.owner_public), "0".repeat(32), vector.sealed)).rejects.toThrow();
  });
});
