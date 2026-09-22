import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  AuthTokenExchangeRequest,
  AuthEnvironmentBootstrapTokenType,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
} from "./auth.ts";
import { LegacyEnvironmentBootstrapTokenType } from "./legacyNames.ts";

const decode = Schema.decodeUnknownSync(AuthTokenExchangeRequest);
describe("bootstrap protocol migration", () => {
  it.each([AuthEnvironmentBootstrapTokenType, LegacyEnvironmentBootstrapTokenType])(
    "accepts the supported type %s",
    (subject_token_type) => {
      expect(
        decode({
          grant_type: AuthTokenExchangeGrantType,
          subject_token_type,
          subject_token: "synthetic-pairing-fixture",
          requested_token_type: AuthAccessTokenType,
        }).subject_token_type,
      ).toBe(subject_token_type);
    },
  );
  it("does not broaden acceptance to arbitrary token types", () => {
    expect(() =>
      decode({
        grant_type: AuthTokenExchangeGrantType,
        subject_token_type: "unrecognized",
        subject_token: "synthetic-pairing-fixture",
        requested_token_type: AuthAccessTokenType,
      }),
    ).toThrow();
  });
});
