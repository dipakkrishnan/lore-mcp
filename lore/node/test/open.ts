// The owner side of contracts/inbox.md "Sealing": what the Mac does to a sealed item.
// Its own file, apart from test/inbox.ts, because it needs no Worker: test/unit/seal.test.ts
// runs it in plain node (XC-099), and the workerd tests reach it through test/inbox.ts.
import { fromB64url, sealingKey } from "../src/seal";

export async function open(privateKey: CryptoKey, ownerPublic: Uint8Array<ArrayBuffer>, itemId: string, sealed: string): Promise<unknown> {
  const bytes = fromB64url(sealed);
  const eph = bytes.slice(0, 32);
  const key = await sealingKey(privateKey, eph, new Uint8Array([...eph, ...ownerPublic]));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(32, 44), additionalData: new TextEncoder().encode(itemId) }, key, bytes.slice(44));
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}
