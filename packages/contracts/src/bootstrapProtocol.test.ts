import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  AuthTokenExchangeRequest,
  AuthEnvironmentBootstrapTokenType,
  AuthAccessTokenType,
  AuthTokenExchangeGrantType,
} from "./auth.ts";

const decode = Schema.decodeUnknownSync(AuthTokenExchangeRequest);
describe("UpComputer bootstrap protocol", () => {
  it.each([AuthEnvironmentBootstrapTokenType])(
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
  it("rejects the retired T3 token type", () => {
    expect(() =>
      decode({
        grant_type: AuthTokenExchangeGrantType,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        subject_token: "synthetic-pairing-fixture",
        requested_token_type: AuthAccessTokenType,
      }),
    ).toThrow();
  });
});
