import { msg } from "gt-react";

/** Every string of the free agent's first message and its setup controls. */
export const AGENT_SETUP_OFFER_COPY = {
  message: msg("I'm ready to help you set up your agents. Which ones do you want to use?"),
  repliesLabel: msg("Quick replies"),
  claude: msg("Claude Code"),
  codex: msg("Codex"),
  antigravity: msg("Antigravity"),
  somethingElse: msg("Something else"),
  notNow: msg("Not now"),
  typePlaceholder: msg("Type the agent you want to use"),
  terminalHint: msg("Review the command, then press Enter"),
  terminalClose: msg("Close"),
  switchChat: msg("Switch this chat to {agent}"),
};
