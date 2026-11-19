# Automations

An automation creates a task on a schedule, such as every weekday at 9:00. The task then goes to a
worker like any other task. Use automations for recurring work: a daily dependency check, a weekly
report, a monthly cleanup.

Open **Tasks**, choose **Workers** in the Me / Workers switch, then **Automations**.

## How automations and tasks fit together

An automation never runs an agent by itself. When its time comes, it creates a task for workers
from its template. A worker starts on that task only if the task's status and tags match the
worker's triggers. See [When a worker starts](./workers.md#when-a-worker-starts).

So an automation needs a worker that waits for its tasks. Give the task the status and tags of the
worker that should do it, or ask a chat to set up both.

## Create an automation

Ask in any chat: "Every Monday at 9:00, create a task for the review worker to check open pull
requests". The chat creates the automation as a draft. You enable it yourself.

To create one by hand, click **+** on the Automations list. Set:

- A name and a project.
- **Schedule**: **Daily**, **Weekly** (pick the days), **Monthly** (pick the day of the month), or
  **Custom** with a cron expression. Then a time and a time zone, which defaults to your computer's.
- **Missed run**: what to do when the computer was asleep or Up.computer was closed at the
  scheduled time. **Run once after a missed window** catches up with one run. **Skip missed windows
  entirely** waits for the next time.
- **Skip if open**: don't create a new task while an earlier task from this automation is still
  open. On by default.
- The task to create: **Title**, **Status**, **Tags** and description. Write the description so a
  worker can do the job without any other context.

**Runs** shows the next and last time it runs.

## Turn it on and off

A new automation stays disabled until you enable it. Use the switch in its window, or **Enable**
and **Disable** in its row's menu. Only you can enable an automation; agents can only create
drafts.

An automation turns itself off, with the notice **Automation turned off**, after it fails to create
its task 5 times or when its schedule stops being valid. Fix the problem and enable it again.

**Delete automation** removes it. Tasks it already created stay.

## Things to know

- "Open" in **Skip if open** means not archived. A task that is **Done** but not archived still
  blocks the next run. Archive finished tasks, or turn **Skip if open** off.
- The created task's status defaults to `new`. Change it to your worker's start status, such as
  To Do, or the task waits.
- There is no way to run an automation right now. To test one, create the same task by hand.

## Scheduled prompts are different

**Settings → Scheduled prompts** is a separate feature. A scheduled prompt sends a message to an
agent in a chat on a schedule or on a webhook, with no task involved. Use it when you want a
recurring chat message rather than a tracked task. See
[Scheduled tasks](./project-settings.md#scheduled-tasks-on-mobile).
