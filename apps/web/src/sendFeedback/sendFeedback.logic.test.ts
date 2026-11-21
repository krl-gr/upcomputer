import type { UserFeedbackSystemInfo } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EMPTY_FEEDBACK_DRAFT, type FeedbackDraft, feedbackPayload } from "./sendFeedback.logic";

const INFO: UserFeedbackSystemInfo = {
  appVersion: "0.9.3",
  system: "macOS (arm64)",
  providers: ["Claude", "Codex"],
};

const draft = (overrides: Partial<FeedbackDraft>): FeedbackDraft => ({
  ...EMPTY_FEEDBACK_DRAFT,
  text: "  The sidebar flickers  ",
  ...overrides,
});

describe("feedbackPayload", () => {
  it.each([
    {
      name: "both boxes off: only the words",
      draft: draft({ includeSystemInfo: false }),
      account: "alex@example.com",
      expected: { text: "The sidebar flickers" },
    },
    {
      name: "system info on by default",
      draft: draft({}),
      account: null,
      expected: { text: "The sidebar flickers", systemInfo: INFO },
    },
    {
      name: "email box on: the Connect account's email when not edited",
      draft: draft({ includeSystemInfo: false, canEmail: true }),
      account: "alex@example.com",
      expected: { text: "The sidebar flickers", email: "alex@example.com" },
    },
    {
      name: "email box on: the typed email wins over the account's",
      draft: draft({ includeSystemInfo: false, canEmail: true, email: " sam@example.com " }),
      account: "alex@example.com",
      expected: { text: "The sidebar flickers", email: "sam@example.com" },
    },
    {
      name: "email box off: a typed email is not sent",
      draft: draft({ includeSystemInfo: false, canEmail: false, email: "sam@example.com" }),
      account: "alex@example.com",
      expected: { text: "The sidebar flickers" },
    },
    {
      name: "email box on with no email: nothing to send",
      draft: draft({ includeSystemInfo: false, canEmail: true, email: "  " }),
      account: "alex@example.com",
      expected: { text: "The sidebar flickers" },
    },
  ])("$name", ({ draft, account, expected }) => {
    expect(feedbackPayload(draft, account, INFO)).toEqual(expected);
  });
});
