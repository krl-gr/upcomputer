# Bots

A bot is a personal assistant: one permanent chat with its own memory. You talk to it like any
chat, it remembers what matters, and it can do bigger jobs in the background while you keep
talking.

Bots work best with a clear role. Name them after the job, such as "Inbox manager", "Release
helper" or "Research assistant", and say in the instructions what the job covers.

## Create a bot

- From scratch: click **+** next to **Bots** in the sidebar. Set it up on the **New bot** page and
  click **Create bot**. Its chat opens.
- From an existing chat: right-click the chat in the sidebar, or click its title in the chat
  header, and choose **Turn into bot**. The chat keeps its history, model and permissions. A chat
  that is still running, archived, or a worker's run can't become a bot.
- By asking: tell a bot or any chat to create a bot, such as "make me a release helper bot".
  The agent creates it with the same settings, and can also change or delete bots when you ask.

## One permanent chat

Each bot has exactly one conversation. Click the bot's row under **Bots** to open it. The chat is
listed there instead of under **Threads**, and search still finds it. Restarting the app or
changing the bot's model keeps the same conversation and its history. There is no "new chat" for a
bot: keep talking in the same one.

The agent's working memory of the conversation stays bounded, but the full history is kept. The
bot can search its older messages when it needs them.

To write to a bot from any other chat, start the message with `@` and the bot's name, such as
`@Release helper prepare version 2.1`. The message goes to the bot's chat, the bot answers there,
and the chat you wrote in does not start a turn. Pick the bot from the `@` menu or type its name.

A bot's chat uses a compact one-line composer. To get the full composer with its model controls,
turn on **Settings → Chat → Full composer in bot chats**.

## Change a bot

Hover the bot's row and click its settings button to open its page. There you change:

- **Name** and **Appearance**: shape, color and accessories.
- **Instructions**: what the bot does and how.
- **Model**: the agent and model it uses.
- **Permissions**: for the bot's chat and its background tasks.
- **Project**: where the bot works. Its chat moves with it, and its memory stays the same.

Changes save automatically and apply from the bot's next turn. Its access to files follows the
permissions you choose here. A change of project or provider
waits until the bot is idle. A bot works in one project; to tell it about others, write it in its
instructions.

## Memory

Memory is a list of facts that belongs to the bot. It stays the same when you change the bot's
model or project.

- **The bot saves facts by itself** during its turns, when it learns something useful that will
  last. Each saved fact shows as a **Saved** card in the chat.
- **You can tell it what to remember**: start a message with **Remember:** followed by the fact.
  The colon is required. Only your own messages save this way, not messages agents post into the
  chat.

To see and edit memory, open the bot's page and scroll to **Memory**. Click a fact to edit it
(Enter saves, Escape cancels), or delete it. The bot can forget facts it saved itself, but it can't
change or forget a fact you saved or edited.

A bot keeps up to 200 facts. Each new conversation with the model gets as many as fit in about
12,000 characters, your facts first, then the newest. The page dims the facts that don't fit; the
bot can still look them up.

## Background work

Ask the bot for something bigger and it works on it in the background, so its chat stays free:

- It can give the job to itself as a background task, which runs as a separate run.
- It can hand the job to one of your [workers](./workers.md). If none fits, it creates one without
  asking, with **Full access** unless you ask for another mode.

The work shows in **Tasks** like any other task. Progress and results come back to the bot's chat,
and the bot replies when the work finishes. See
[Wake chat when tasks complete](./getting-started.md#a-worker-picks-it-up) to change that.

Background tasks can read untrusted pages and files, so they can't save memory. What a task found
comes back in its result, and the bot decides in its own chat what to remember.

## Bot status

A bot's row shows the same statuses as a thread row, and also counts its background work:
**Waiting** while its task runs, **Awaiting Input** when the task is blocked, and **Failed** when it
fails, until you open the bot's chat. It shows **Pending Approval** or **Awaiting Input** while any
task started from its chat waits for you. Hover the bot's name to see why.

## Remove a bot

Click **Remove bot** at the bottom of the bot's page. This deletes its memory. Its chat goes back
to **Threads** as an ordinary chat.
