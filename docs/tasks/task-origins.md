# Task origins and sidebar run counts

Task creation records immutable `rootThreadId`, `parentTaskId`, and `parentRunId`.
They are output fields, not model-editable tool/RPC inputs. `sourceThreadId` and
`sourceRunId` remain the existing editable source references; editing them does
not reparent an established chain.

The repository resolves a parent run from the trusted invocation thread, falling
back to the supplied source thread/run for non-tool creation. Invocation context
wins over a conflicting model-supplied run ID. Assignment (`assigneeAgentRunId`)
is never evidence of ancestry. A child inherits its parent's stored root; a
normal chat creates a new root. Ambiguous runs, missing explicit run references,
and parents with unknown origins do not produce guessed roots. Existing IDs keep
their established lineage, and parent deletion does not clear descendants' roots.
Reusing a deleted ID cannot introduce a cycle: IDs already referenced by children
receive a cycle-safe ancestor check on creation. Ordinary fresh IDs only need
indexed lookups; no ancestry traversal occurs while reading sidebar counts.

Migration 011 adds nullable columns and indexes, **without historical backfill**.
New descendants of legacy tasks keep an unknown root. Proposal metadata is
optional annotation inherited from the same authoritative parent, not a condition
for recording lineage. All creation paths use the repository boundary.

The sidebar replaces the timestamp with nonzero run counts by status; the font
is inherited, colors match Tasks, and the tooltip includes the timestamp and
status names. Counts include previous attempts, not just the latest run of each
task. Tasks with unknown roots are excluded. No runs means the normal timestamp.
On row hover the timestamp fades as before, while counts stay visible and shift
left to make room for the row actions.

The counts are a button that does not open the chat. It opens a menu of the
thread's tasks, open ones first and then closed ones, each group in Tasks order,
at most 50. Every item shows the task's own counts, and clicking an item opens
its detail in Tasks. `tasks.threadTasks` loads that list with one indexed
`root_thread_id` query, only while the menu is open. It computes run counts the
same way as the Tasks table, and nothing is prefetched or subscribed.

`tasks.threadRunCounts` aggregates using `(root_thread_id, id)` and
`(task_id, status)` indexes. It accepts up to 500 root IDs per request; it does not
load task descriptions, run histories, or recursively walk ancestry. A shared
store per environment client batches mounted rows, subscribes to the existing
task change stream, and refreshes affected roots only. Reconnect/sequence gaps
reconcile the mounted roots; failures retain existing counts and retry with
backoff. There is no idle data polling. The stream closes on last unsubscribe.
Creation/deletion membership changes notify roots after commit, including reuse
of IDs with retained historical runs. Cosmetic edits do not refresh aggregates.

The public host's optional `threadAccessory` web-feature contribution owns only
content. The sidebar retains layout, timestamp fallback, and environment-specific
capability gating. No private Tasks imports are added to the public host.

Focused coverage: `TaskRank.test.ts`, `TaskToolService.test.ts`,
`TaskPageRpc.test.ts`, `threadRunCounts.test.ts`, `taskRunPresentation.test.ts`,
and the public `SidebarThreadAccessory.test.tsx`. The repository test includes indexed
aggregation of 10,000 tasks / 50,000 runs across 100 roots. This is not a promise
of production latency on arbitrary hardware.
