import { assert, it } from "@effect/vitest";

import { pickSourceRef } from "./TriageService.ts";

const MAIN = "a1dc856ee61278d0199c36d4bcdef5fdea4d21fe\trefs/heads/main";

it("clones our core-v release tag, and the v tag of nightlies and older releases", () => {
  assert.deepEqual(
    pickSourceRef(
      `${MAIN}\n1111111\trefs/tags/v0.0.39\n2222222\trefs/tags/core-v0.0.39\n`,
      "0.0.39",
    ),
    { ref: "core-v0.0.39", commit: "2222222" },
  );
  assert.deepEqual(
    pickSourceRef(
      `${MAIN}\n3333333\trefs/tags/v0.0.40-nightly.20261118.764\n`,
      "0.0.40-nightly.20261118.764",
    ),
    { ref: "v0.0.40-nightly.20261118.764", commit: "3333333" },
  );
});
