import { assert, it } from "@effect/vitest";

import { makeNativeProviderFailure } from "./failure.ts";

it("keeps the sentence's period after a redacted credential", () => {
  assert.equal(
    makeNativeProviderFailure({
      driver: "muse",
      provider: "Muse",
      text: "Provider rejected this turn: api_key=abc123",
    }).message,
    "Muse reported an error: provider rejected this turn: api_key=[REDACTED]. Send the message again.",
  );
});
