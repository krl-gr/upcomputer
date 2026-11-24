import { msg } from "gt-react";

/*
 * Every plain string of the no-agent screen, so the copy changes in one place.
 * Card 1's description holds a link, so it lives in the screen.
 */
export const NO_AGENT_COPY = {
  offer: {
    title: msg("Let's get you an agent"),
    intro: msg(
      "We didn't find Claude Code, Codex or another coding agent on this Mac. Up.computer works with the agents you already have.",
    ),
    installTitle: msg("Install a free agent"),
    installTag: msg("Easiest"),
    askTitle: msg("Ask your own agent"),
    askDescription: msg("Copy a setup prompt for Claude, ChatGPT or any agent you already use."),
    askCopied: msg("Copied. Paste it into your agent."),
    setupTitle: msg("Set up myself"),
    setupDescription: msg("Install or connect Claude Code, Codex, Antigravity and more."),
  },
  installing: {
    downloading: {
      title: msg("Installing OpenCode"),
      line: (percent: number) => msg("Downloading… {percent}%", { percent }),
    },
    starting: {
      title: msg("Starting OpenCode"),
      line: msg("Installed. Getting your agent ready."),
    },
    slow: {
      title: msg("Still starting OpenCode"),
      line: msg("This can take a minute or two the first time."),
    },
    retrying: {
      title: msg("Trying again"),
      line: msg("Getting OpenCode ready."),
    },
  },
  failed: {
    install: {
      title: msg("Couldn't install OpenCode"),
      line: msg("Something went wrong while installing. Check your connection and try again."),
    },
    timeout: {
      title: msg("OpenCode didn't respond"),
      line: msg("It took too long to start. Try again."),
    },
    models: {
      title: msg("Free models aren't available"),
      line: msg("OpenCode can't reach its free models right now. Try again later."),
    },
  },
  tryAgain: msg("Try again"),
  setUpAnotherWay: msg("Set up another way"),
} as const;
