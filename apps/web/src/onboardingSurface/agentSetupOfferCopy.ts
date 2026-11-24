import { msg } from "gt-react";

/** Every string of the free agent's first message and its setup controls. */
export const AGENT_SETUP_OFFER_COPY = {
  message: msg("I'm ready to help you set up your agents. Which one do you want to start with?"),
  notNowReply: msg("You can ask me to set up your agents anytime."),
  repliesLabel: msg("Quick replies"),
  claude: msg("Claude Code"),
  codex: msg("Codex"),
  antigravity: msg("Antigravity"),
  somethingElse: msg("Something else"),
  notNow: msg("Not now"),
  typePlaceholder: msg("Type the agent you want to use"),
  switchChat: msg("Switch this chat to {agent}"),
};
