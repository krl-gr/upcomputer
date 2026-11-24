/**
 * What "Copy a setup prompt for your own agent" copies. The reader is an agent
 * the user already talks to somewhere else (Claude on the web, ChatGPT, Cursor),
 * so it stays in English and names the commands the Welcome page also runs.
 */
export const NO_AGENT_SETUP_PROMPT = `I just installed Up.computer on my Mac. It is a desktop app for working with coding agents, and it runs the agents that are already installed on this Mac with my own subscription. It did not find one, so please help me set one up.

Go one step at a time. Give me one command, wait for what I see, then go on.

1. Ask which plan I already pay for: Claude (Pro or Max), ChatGPT (Plus, Pro or Business), an API key, or none. Pick the agent that fits:
   - Claude plan or Anthropic API key: Claude Code
   - ChatGPT plan or OpenAI API key: Codex
   - something else: the command-line agent for it, such as Grok, Cursor, Gemini CLI or OpenCode
   - none: tell me the cheapest way to start, then go on with that agent

2. Help me install it in the Terminal app (Applications, Utilities, Terminal):
   - Claude Code: curl -fsSL https://claude.ai/install.sh | bash
   - Codex: curl -fsSL https://chatgpt.com/codex/install.sh | sh
   - another agent: use its official install instructions
   If you can browse, check the official docs first. Install commands change.

3. Help me sign in:
   - Claude Code: run "claude" and follow the login in the browser
   - Codex: run "codex login" and choose "Sign in with ChatGPT"
   Tell me what I should see when it worked.

4. Check it: run "claude --version" or "codex --version". If the command is not found, have me open a new Terminal window and try again before anything else.

5. Send me back to Up.computer: quit it and open it again. It finds installed agents by itself and a new chat opens on that agent. If the agent is missing, have me open Settings, then Providers, and look at the agent's row there. "which claude" or "which codex" in Terminal shows the path to enter.

Keep answers short. If a command fails, ask me to paste the full output before you guess.`;
