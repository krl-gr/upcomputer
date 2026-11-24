/**
 * What "Copy a setup prompt for your own agent" copies. The reader is an agent
 * the user already talks to somewhere else (Claude on the web, ChatGPT, Cursor),
 * so it stays in English and names the commands the Welcome page also runs.
 */
export const NO_AGENT_SETUP_PROMPT = `I just installed Up.computer on my Mac, a desktop app for coding agents. It runs the agents installed on this Mac with my own subscription, and it found none. Please help me set one up.

First: can you run commands on this Mac yourself?
- Yes: do each step yourself and tell me what you did.
- No (for example Claude or ChatGPT on the web): give me one step at a time for the Terminal app (Applications, Utilities, Terminal), wait for what I see, then go on.

1. Plan. Ask me once which plan I have. Claude Pro or Max: Claude Code. ChatGPT Plus, Pro or Business: Codex. None: tell me the cheapest way to start.

2. Install:
   - Claude Code: curl -fsSL https://claude.ai/install.sh | bash
   - Codex: curl -fsSL https://chatgpt.com/codex/install.sh | sh

3. Sign in. I do this myself in Terminal, because it opens the browser:
   - Claude Code: ~/.local/bin/claude auth login
   - Codex: ~/.local/bin/codex login, then choose "Sign in with ChatGPT"

4. Check: ~/.local/bin/claude auth status, or ~/.local/bin/codex login status. If the command is not found, open a new Terminal window and try again.

5. Back to Up.computer: open Settings, then Providers, and press Refresh, or quit Up.computer and open it again. It finds the agent and a new chat uses it.

Keep answers short. If a command fails, ask me for the full output before you guess.`;
