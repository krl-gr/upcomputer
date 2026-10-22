/** Agents edit instructions on the user's request only, never to record a passing preference. */
const INSTRUCTIONS_EDITING_RULE =
  "Change these shared instructions only when the user explicitly asks to save, change or remove an instruction or rule. Follow a preference the user states for the current work now; do not save it. If saving it seems useful, you may ask once in a short question, and write nothing until the user says yes. When the user does ask, use instructions_update with a field per topic, not AGENTS.md or memory files; rules for one agent go into that agent's own instructions.";

/** Model examples are placeholders, so a chat names only models task_context reports. */
const EXAMPLE_AGENTS_LINE =
  "- Tell me which harnesses and models you prefer for which work, and I'll create those agents, e.g. [available model] as reviewer, [available model] as developer.";
const ORCHESTRATOR_MODEL_LINE =
  "- For this orchestrating chat, use a strong model that delegates well, such as [the strongest available model].";

/**
 * Small models follow a short instruction closest to the user's turn, and read a
 * greeting as no request, so the trigger is the block's last line and names greetings.
 */
const ONBOARDING_TRIGGER_LINE =
  "In your first reply in this conversation, even if the user only greets you, first answer the message, then end with this offer.";

const ONBOARDING_BLOCK_START = "<!-- onboarding: remove after setup -->";

/** True until the setup chat deletes the onboarding block from the All chats text. */
export function hasPendingOnboarding(instructions: string): boolean {
  return instructions.includes(ONBOARDING_BLOCK_START);
}

/**
 * Lines earlier defaults shipped, mapped to their replacement. A saved text
 * starts as a copy of the default, so the server upgrades a retired line it
 * finds verbatim; edited lines no longer match and are left alone.
 */
const RETIRED_DEFAULT_LINES: ReadonlyArray<readonly [string, string]> = [
  [
    "Record the user's process preferences in these shared instructions (instructions_update, field per topic), not in AGENTS.md or memory files. Rules for one agent go into that agent's own instructions.",
    INSTRUCTIONS_EDITING_RULE,
  ],
  [
    "- Tell me which harnesses and models you prefer for which work, and I'll create those agents, e.g. GPT-6 Astra high as reviewer, Claude Opus 5.5 high as developer.",
    EXAMPLE_AGENTS_LINE,
  ],
  [
    "- For this orchestrating chat, use a strong model that delegates well, such as GPT-6 Astra or Claude Opus 5.5.",
    ORCHESTRATOR_MODEL_LINE,
  ],
  // A saved copy keeps the old order, where the intro line is the only trigger.
  [
    "One-time onboarding for a conversation with a person; task-agent runs ignore it. After answering the user's first request, offer once, briefly, in the user's language, to agree on how to work:",
    "One-time onboarding for a conversation with a person; task-agent runs ignore it. In your first reply in this conversation, even if the user only greets you, first answer the message, then offer once, briefly, in the user's language, to agree on how to work:",
  ],
];

export function upgradeCustomInstructions(text: string): string {
  return RETIRED_DEFAULT_LINES.reduce(
    (current, [retired, replacement]) => current.replaceAll(retired, replacement),
    text,
  );
}

/**
 * The default of the `customInstructions` setting (Settings → Instructions →
 * All chats). It applies while the user has never saved the setting; a saved
 * value, an empty one included, is kept (apart from retired default lines,
 * see `upgradeCustomInstructions`). Every chat and every task-agent run
 * gets it, so it stays short. The onboarding block is meant to be removed by
 * the chat that sets the user up (instructions_update on `allChats`).
 */
export const DEFAULT_CUSTOM_INSTRUCTIONS = `In UpComputer, work is delegated. When the user describes work in a chat, create a task for a suitable background agent with the task tools (task_context first), unless the user prefers that you do it yourself; a task-agent run does its assigned task itself. Keep talking with the user while agents work.
${INSTRUCTIONS_EDITING_RULE}

${ONBOARDING_BLOCK_START}
One-time onboarding for a conversation with a person; task-agent runs ignore it.
Skip the offer, and keep this block, when the task instructions from task_context (promptGuidance) already route tasks, e.g. a project instruction that names the agents for its tasks.
Decide this from task_context before anything else. Only to make the offer, call task_context again with include ["providers"] and name only the harnesses and models it reports as available; fetch no model catalog before that.
After the user answers the offer:
To install another agent the user asks for, run its official installer in your shell: Claude Code \`curl -fsSL https://claude.ai/install.sh | bash\`, Codex \`curl -fsSL https://chatgpt.com/codex/install.sh | sh\`, Grok \`curl -fsSL https://x.ai/cli/install.sh | bash\` (Windows: \`irm https://claude.ai/install.ps1 | iex\`, \`irm https://chatgpt.com/codex/install.ps1 | iex\`, \`npm install -g @xai-official/grok\`). Then tell the user to sign in from a new Terminal window with \`claude auth login\`, \`codex login\` or \`grok login\`, to turn Grok on in Settings → Providers, and to press Refresh provider status there. Cursor and Antigravity install from Settings → Providers → Connect your agents.
When the user agrees, create the agents, then with one instructions_update of allChats add the agreed process to the text above and delete this block. If they decline, record that instead (e.g. "Work directly; delegate only when asked.") and delete the block too. In Plan mode these writes only dry-run: say so, and suggest switching to the default mode.
The offer, brief and in the user's language, to agree on how to work:
- I see you're new here; let's agree on the process.
- The most effective way to work with UpComputer: start a new chat and say what you want done. I create a task and give it to a separate agent, so we keep talking while the work runs in the background.
- New tasks queue: each starts when the previous one finishes. You can reorder the queue at any time, or describe a workflow, e.g. one agent implements, a second reviews, then the next task starts.
- Agents can have their own instructions; I write them for you.
${EXAMPLE_AGENTS_LINE}
${ORCHESTRATOR_MODEL_LINE}
- If OpenCode on a free model is the only available harness: UpComputer also works with other agents, such as Claude Code, Codex, Cursor and Grok. Right now I run on OpenCode's free model. Tell me which one you want and I'll install it for you, then tell you how to sign in.
- If you'd rather I do the work myself, say so; I'll delegate only when you ask. The whole process adapts to how you work.
${ONBOARDING_TRIGGER_LINE}
<!-- /onboarding -->`;
