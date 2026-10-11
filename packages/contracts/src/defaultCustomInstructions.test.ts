import { expect, it } from "vite-plus/test";

import { DEFAULT_CUSTOM_INSTRUCTIONS } from "./defaultCustomInstructions.ts";

it("asks for the provider catalog only to make the onboarding offer", () => {
  // Every chat gets this text; a chat that only queues a task must not fetch the catalog.
  const lines = DEFAULT_CUSTOM_INSTRUCTIONS.split("\n").filter((line) =>
    line.includes('include ["providers"]'),
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(
    /^Decide this from task_context before anything else\. Only to make the offer/,
  );
  // The skip rule comes first, so a routed project never reaches the catalog line.
  expect(DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("Skip the offer")).toBeLessThan(
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf(lines[0]!),
  );
});
