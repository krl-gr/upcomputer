import * as Base64Url from "effect/encoding/Base64Url";
import * as Result from "effect/Result";

// Web Push message encryption (RFC 8291, aes128gcm from RFC 8188) and VAPID
// (RFC 8292), on WebCrypto only so it runs in the Worker without node
// modules.

/** One aes128gcm record carries the whole message. */
const RECORD_SIZE = 4096;
// salt (16) + record size (4) + key id length (1) + server public key (65).
const HEADER_LENGTH = 86;
const TAG_LENGTH = 16;
const encoder = new TextEncoder();

/**
 * Push services must accept 4096-byte bodies (RFC 8030 section 7.2). The
 * header, the record delimiter and the GCM tag leave this much plaintext.
 */
export const MAX_WEB_PUSH_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_LENGTH - TAG_LENGTH - 1;

/** VAPID tokens may live at most 24 hours (RFC 8292 section 2). */
export const MAX_VAPID_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

type Bytes = Uint8Array<ArrayBuffer>;

function concat(...parts: ReadonlyArray<Uint8Array>): Bytes {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function decodeBase64Url(value: string): Bytes | null {
  const decoded = Base64Url.decode(value.trim());
  return Result.isSuccess(decoded) ? concat(decoded.success) : null;
}

/** An uncompressed P-256 point: 0x04 || x || y. */
export function isP256PublicKey(bytes: Uint8Array): boolean {
  return bytes.length === 65 && bytes[0] === 0x04;
}

function p256Jwk(publicKey: Uint8Array, privateKey?: Uint8Array): JsonWebKey {
  return {
    kty: "EC",
    crv: "P-256",
    x: Base64Url.encode(publicKey.subarray(1, 33)),
    y: Base64Url.encode(publicKey.subarray(33, 65)),
    ...(privateKey ? { d: Base64Url.encode(privateKey) } : {}),
  };
}

async function hkdf(
  subtle: SubtleCrypto,
  salt: Bytes,
  inputKeyMaterial: Bytes,
  info: Bytes,
  length: number,
): Promise<Bytes> {
  const key = await subtle.importKey("raw", inputKeyMaterial, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8),
  );
}

/** Imports a raw P-256 key pair as an ECDH server key; RFC 8291 test vectors fix it. */
export async function importServerKeyPair(
  subtle: SubtleCrypto,
  input: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array },
): Promise<CryptoKeyPair> {
  const algorithm = { name: "ECDH", namedCurve: "P-256" };
  return {
    privateKey: await subtle.importKey(
      "jwk",
      p256Jwk(input.publicKey, input.privateKey),
      algorithm,
      false,
      ["deriveBits"],
    ),
    publicKey: await subtle.importKey("raw", concat(input.publicKey), algorithm, true, []),
  };
}

export interface WebPushEncryptionInput {
  readonly plaintext: Uint8Array;
  /** The subscription's `p256dh` key. */
  readonly userAgentPublicKey: Uint8Array;
  /** The subscription's `auth` secret. */
  readonly authSecret: Uint8Array;
  /** Fresh per message unless a test fixes it. */
  readonly serverKeyPair?: CryptoKeyPair;
  readonly salt?: Uint8Array;
}

/** Encrypts one push message body with Content-Encoding: aes128gcm. */
export async function encryptWebPushPayload(
  subtle: SubtleCrypto,
  input: WebPushEncryptionInput,
): Promise<Bytes> {
  if (input.plaintext.length > MAX_WEB_PUSH_PLAINTEXT_BYTES) {
    throw new RangeError(
      `Web push payload is ${input.plaintext.length} bytes; the limit is ${MAX_WEB_PUSH_PLAINTEXT_BYTES}.`,
    );
  }
  if (!isP256PublicKey(input.userAgentPublicKey) || input.authSecret.length !== 16) {
    throw new RangeError("Web push subscription keys are malformed.");
  }
  const algorithm = { name: "ECDH", namedCurve: "P-256" };
  const serverKeyPair =
    input.serverKeyPair ??
    ((await subtle.generateKey(algorithm, true, ["deriveBits"])) as CryptoKeyPair);
  const serverPublicKey = new Uint8Array(await subtle.exportKey("raw", serverKeyPair.publicKey));
  const userAgentPublicKey = concat(input.userAgentPublicKey);
  const userAgentKey = await subtle.importKey("raw", userAgentPublicKey, algorithm, false, []);
  const ecdhSecret = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: userAgentKey }, serverKeyPair.privateKey, 256),
  );
  const inputKeyMaterial = await hkdf(
    subtle,
    concat(input.authSecret),
    ecdhSecret,
    concat(encoder.encode("WebPush: info\0"), userAgentPublicKey, serverPublicKey),
    32,
  );
  const salt = concat(input.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const contentKey = await hkdf(
    subtle,
    salt,
    inputKeyMaterial,
    concat(encoder.encode("Content-Encoding: aes128gcm\0")),
    16,
  );
  const nonce = await hkdf(
    subtle,
    salt,
    inputKeyMaterial,
    concat(encoder.encode("Content-Encoding: nonce\0")),
    12,
  );
  const aesKey = await subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record; no padding.
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(input.plaintext, Uint8Array.of(2)),
    ),
  );
  const header = new Uint8Array(HEADER_LENGTH);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPublicKey.length;
  header.set(serverPublicKey, 21);
  return concat(header, ciphertext);
}

/** Imports the VAPID key pair (base64url raw public key and private scalar) for signing. */
export async function importVapidSigningKey(
  subtle: SubtleCrypto,
  input: { readonly publicKey: string; readonly privateKey: string },
): Promise<CryptoKey> {
  const publicKey = decodeBase64Url(input.publicKey);
  const privateKey = decodeBase64Url(input.privateKey);
  if (!publicKey || !isP256PublicKey(publicKey) || privateKey?.length !== 32) {
    throw new RangeError("VAPID keys must be a base64url P-256 public key and private key.");
  }
  return subtle.importKey(
    "jwk",
    p256Jwk(publicKey, privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** The `Authorization: vapid` header value for one push service origin. */
export async function vapidAuthorization(
  subtle: SubtleCrypto,
  input: {
    readonly signingKey: CryptoKey;
    readonly publicKey: string;
    readonly endpoint: string;
    readonly subject: string;
    readonly expiresAtSeconds: number;
  },
): Promise<string> {
  const header = Base64Url.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = Base64Url.encode(
    JSON.stringify({
      aud: new URL(input.endpoint).origin,
      exp: input.expiresAtSeconds,
      sub: input.subject,
    }),
  );
  // WebCrypto ECDSA signatures are already the JWS r || s form.
  const signature = new Uint8Array(
    await subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      input.signingKey,
      encoder.encode(`${header}.${claims}`),
    ),
  );
  return `vapid t=${header}.${claims}.${Base64Url.encode(signature)}, k=${input.publicKey.trim()}`;
}
