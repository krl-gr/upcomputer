import { expect, it } from "vite-plus/test";

import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  upgradeCustomInstructions,
} from "./defaultCustomInstructions.ts";

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

it("upgrades a saved copy of the shipped model examples without adding new onboarding lines", () => {
  // A free-OpenCode-only user must not be offered models they do not have.
  const shipped = [
    "- Tell me which harnesses and models you prefer for which work, and I'll create those agents, e.g. GPT-6 Astra high as reviewer, Claude Opus 5.5 high as developer.",
    "- For this orchestrating chat, use a strong model that delegates well, such as GPT-6 Astra or Claude Opus 5.5.",
    "- If you'd rather I do the work myself, say so; I'll delegate only when you ask.",
  ].join("\n");
  const upgraded = upgradeCustomInstructions(shipped);

  expect(upgraded).not.toMatch(/Astra|Opus/);
  expect(upgraded).not.toContain("OpenCode");
  expect(DEFAULT_CUSTOM_INSTRUCTIONS).toContain(upgraded.split("\n").slice(0, 2).join("\n"));
  expect(DEFAULT_CUSTOM_INSTRUCTIONS).not.toMatch(/Astra|Opus/);
});

it("ends the onboarding block with the trigger, which covers a bare greeting", () => {
  // A small model reads "hi" as no request and follows the line closest to the user turn.
  const block = DEFAULT_CUSTOM_INSTRUCTIONS.slice(
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- onboarding: remove after setup -->"),
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- /onboarding -->"),
  );
  const lines = block.trimEnd().split("\n");
  expect(lines.at(-1)).toMatch(
    /^In your first reply in this conversation, even if the user only greets you/,
  );
  expect(block).not.toContain("After answering the user's first request");
});

it("gives a saved copy of the shipped onboarding intro the greeting trigger", () => {
  const shipped =
    "One-time onboarding for a conversation with a person; task-agent runs ignore it. After answering the user's first request, offer once, briefly, in the user's language, to agree on how to work:";
  const upgraded = upgradeCustomInstructions(shipped);

  expect(upgraded).toContain("even if the user only greets you");
  expect(upgraded).not.toContain("After answering the user's first request");
  expect(upgradeCustomInstructions(upgraded)).toBe(upgraded);
});

it("gives sign-in commands by the path each installer uses", () => {
  // The app's PATH already has these folders, so an installer run from the agent's
  // shell skips the shell profile and a new Terminal cannot find the bare command.
  const installLine = DEFAULT_CUSTOM_INSTRUCTIONS.split("\n").find((line) =>
    line.includes("codex/install.sh"),
  );
  expect(installLine).toContain("`~/.local/bin/claude auth login`");
  expect(installLine).toContain("`~/.local/bin/codex login`");
  expect(installLine).toContain("`~/.grok/bin/grok login`");
});
