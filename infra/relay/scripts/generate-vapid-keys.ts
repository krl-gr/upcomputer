// Prints a new VAPID key pair for web push, in the form the relay and the web
// build read:
//
//   node scripts/generate-vapid-keys.ts
//
// WEB_PUSH_VAPID_PUBLIC_KEY goes to the relay and to the web build (it is
// public). WEB_PUSH_VAPID_PRIVATE_KEY is a secret: store it only as the relay's
// secret. Replacing the pair invalidates every existing browser subscription;
// each device has to turn notifications on again.
import * as Base64Url from "effect/encoding/Base64Url";

const { subtle } = globalThis.crypto;
const keyPair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
])) as CryptoKeyPair;
const publicKey = Base64Url.encode(
  new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey)),
);
const { d: privateKey } = await subtle.exportKey("jwk", keyPair.privateKey);

process.stdout.write(
  `WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}\nWEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}\n`,
);
