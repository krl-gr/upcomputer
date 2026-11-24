import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CUSTOM_INSTRUCTIONS,
  FREE_AGENT_SETUP_INSTRUCTIONS,
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

it("ends the onboarding block with the trigger, tied to the first-conversation note", () => {
  // A small model reads "hi" as no request and follows the line closest to the user turn.
  // Only the server's note tells the first conversation from later ones.
  const block = DEFAULT_CUSTOM_INSTRUCTIONS.slice(
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- onboarding: remove after setup -->"),
    DEFAULT_CUSTOM_INSTRUCTIONS.indexOf("<!-- /onboarding -->"),
  );
  const lines = block.trimEnd().split("\n");
  expect(lines.at(-1)).toMatch(
    /^Make this offer only when this turn's UpComputer onboarding note asks for it: then, even if the user only greets you/,
  );
  expect(lines.at(-1)).toContain("Otherwise do not make the offer");
  expect(block).not.toContain("After answering the user's first request");
  expect(block).not.toContain("first reply in this conversation");
});

it("ties a saved copy of the shipped onboarding intro to the note, greetings included", () => {
  const shipped =
    "One-time onboarding for a conversation with a person; task-agent runs ignore it. After answering the user's first request, offer once, briefly, in the user's language, to agree on how to work:";
  const upgraded = upgradeCustomInstructions(shipped);

  expect(upgraded).toContain("Only when this turn's UpComputer onboarding note asks for it");
  expect(upgraded).toContain("even a greeting");
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

it("leaves the free agent's setup to its own block", () => {
  // The free agent sets up agents with FREE_AGENT_SETUP_INSTRUCTIONS; the offer is for real agents.
  expect(DEFAULT_CUSTOM_INSTRUCTIONS).not.toContain("OpenCode");
  const shipped =
    "- I write them for you.\n- If OpenCode on a free model is the only available harness: UpComputer also works with other agents, such as Claude Code, Codex, Cursor and Grok. Right now I run on OpenCode's free model. Tell me which one you want and I'll install it for you, then tell you how to sign in.\n- If you'd rather I do the work myself, say so.";
  expect(upgradeCustomInstructions(shipped)).toBe(
    "- I write them for you.\n- If you'd rather I do the work myself, say so.",
  );
});

it("signs a newly installed agent in through the chat first", () => {
  const shipped =
    "Then tell the user to sign in from a new Terminal window with the full path, `~/.local/bin/claude auth login`, `~/.local/bin/codex login` or `~/.grok/bin/grok login` (Windows: `claude auth login`, `codex login`, `grok login`), to turn Grok on in Settings → Providers, and to press Refresh provider status there.";
  const upgraded = upgradeCustomInstructions(shipped);
  expect(upgraded).toMatch(/^Then call provider_sign_in for it/);
  expect(DEFAULT_CUSTOM_INSTRUCTIONS).toContain(upgraded);
  expect(upgradeCustomInstructions(upgraded)).toBe(upgraded);
});

describe("FREE_AGENT_SETUP_INSTRUCTIONS", () => {
  const lines = FREE_AGENT_SETUP_INSTRUCTIONS.split("\n");

  it("answers the app's first message and covers every choice", () => {
    expect(FREE_AGENT_SETUP_INSTRUCTIONS).toContain("Which one do you want to start with?");
    for (const choice of ["Claude Code", "Codex", "Antigravity", "something else", "not now"]) {
      expect(FREE_AGENT_SETUP_INSTRUCTIONS.toLowerCase()).toContain(choice.toLowerCase());
    }
  });

  it("asks for the plan, installs, signs in through the tool and checks", () => {
    const step = (prefix: string) => lines.find((line) => line.startsWith(prefix)) ?? "";
    expect(step("1.")).toMatch(/^1\. Before you install anything, ask once/);
    expect(step("1.")).toContain("Claude Pro or Max");
    expect(step("1.")).toContain("ChatGPT Plus, Pro or Business");
    expect(step("2.")).toContain("https://claude.ai/install.sh");
    expect(step("2.")).toContain("https://chatgpt.com/codex/install.sh");
    expect(step("3.")).toContain("provider_sign_in");
    expect(step("4.")).toContain("provider_sign_in again to check");
    expect(step("4.")).toContain("switching this chat");
    // The installers are the same ones the onboarding block names.
    expect(DEFAULT_CUSTOM_INSTRUCTIONS).toContain("curl -fsSL https://claude.ai/install.sh | bash");
  });

  it("falls back to Terminal with full paths", () => {
    const fallback = lines.find((line) => line.startsWith("If provider_sign_in is missing")) ?? "";
    expect(fallback).toContain("`~/.local/bin/claude auth login`");
    expect(fallback).toContain("`~/.local/bin/codex login`");
  });

  it("keeps small-model lines short and ends with the trigger", () => {
    const body = lines.slice(1, -1);
    for (const line of body) expect(line.length).toBeLessThan(400);
    expect(body.at(-1)).toMatch(/^Use these steps whenever/);
    expect(FREE_AGENT_SETUP_INSTRUCTIONS).not.toContain("—");
  });
});
