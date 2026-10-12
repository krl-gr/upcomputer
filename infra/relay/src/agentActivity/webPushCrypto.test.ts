import { describe, expect, it } from "@effect/vitest";
import * as Base64Url from "effect/encoding/Base64Url";

import {
  decodeBase64Url,
  encryptWebPushPayload,
  importServerKeyPair,
  importVapidSigningKey,
  MAX_WEB_PUSH_PLAINTEXT_BYTES,
  vapidAuthorization,
} from "./webPushCrypto.ts";

const { subtle } = globalThis.crypto;
const bytes = (value: string) => decodeBase64Url(value)!;

// RFC 8291 Appendix A.
const rfc8291 = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  serverPrivateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  serverPublicKey:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  userAgentPublicKey:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("web push encryption", () => {
  it("matches the RFC 8291 test vector", async () => {
    const body = await encryptWebPushPayload(subtle, {
      plaintext: bytes(rfc8291.plaintext),
      userAgentPublicKey: bytes(rfc8291.userAgentPublicKey),
      authSecret: bytes(rfc8291.authSecret),
      salt: bytes(rfc8291.salt),
      serverKeyPair: await importServerKeyPair(subtle, {
        publicKey: bytes(rfc8291.serverPublicKey),
        privateKey: bytes(rfc8291.serverPrivateKey),
      }),
    });
    expect(Base64Url.encode(body)).toBe(rfc8291.body);
  });

  it("fits the largest allowed payload in one 4096-byte message", async () => {
    const body = await encryptWebPushPayload(subtle, {
      plaintext: new Uint8Array(MAX_WEB_PUSH_PLAINTEXT_BYTES),
      userAgentPublicKey: bytes(rfc8291.userAgentPublicKey),
      authSecret: bytes(rfc8291.authSecret),
    });
    expect(body.length).toBe(4096);
    await expect(
      encryptWebPushPayload(subtle, {
        plaintext: new Uint8Array(MAX_WEB_PUSH_PLAINTEXT_BYTES + 1),
        userAgentPublicKey: bytes(rfc8291.userAgentPublicKey),
        authSecret: bytes(rfc8291.authSecret),
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe("VAPID", () => {
  it("signs an ES256 JWT for the push service origin that verifies with the public key", async () => {
    const keyPair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicKey = Base64Url.encode(
      new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey)),
    );
    const privateKey = (await subtle.exportKey("jwk", keyPair.privateKey)).d!;

    const header = await vapidAuthorization(subtle, {
      signingKey: await importVapidSigningKey(subtle, { publicKey, privateKey }),
      publicKey,
      endpoint: "https://web.push.apple.com/QGuQyavXutnMH1jBXAIxBg?x=1",
      subject: "mailto:push@up.computer",
      expiresAtSeconds: 1_800_000_000,
    });

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwtHeader, jwtClaims, signature, key] = match!;
    expect(key).toBe(publicKey);
    expect(JSON.parse(new TextDecoder().decode(bytes(jwtHeader!)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(new TextDecoder().decode(bytes(jwtClaims!)))).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_800_000_000,
      sub: "mailto:push@up.computer",
    });
    await expect(
      subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        keyPair.publicKey,
        bytes(signature!),
        new TextEncoder().encode(`${jwtHeader}.${jwtClaims}`),
      ),
    ).resolves.toBe(true);
  });

  it("rejects malformed VAPID keys", async () => {
    await expect(
      importVapidSigningKey(subtle, { publicKey: "not-a-key", privateKey: "short" }),
    ).rejects.toThrow(RangeError);
  });
});
