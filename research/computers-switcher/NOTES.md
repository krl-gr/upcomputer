# Computers switcher: research notes (phase 1)

Mockup: `mockup.html` in this folder (open it in a browser, it is self-contained).
Based on `origin/release/0.0.37` at `2dcb8359ee`, compared with the pending upstream sync
`origin/sync/upstream-2026-10` (PR #45).

## Proposal in one paragraph

A switcher row at the very top of the sidebar, above Search, shown only when two or more
computers are known. It picks This Mac (default), one other computer, or All computers. Projects,
Bots, Threads (every shelf) and sidebar Search follow the choice. Each computer in the menu shows
its machine icon with a status dot (online, offline, older version), its kind and version, and its
Working / Awaiting input / Approval counts in the thread row colours. While one computer is
selected, the switcher row carries a small badge for runs that wait for the user on the _other_
computers, so nothing there is missed. All computers keeps one list per section (recommended), with
the machine icon on rows from other computers and a machine label inside Bots. The literal "group
everything by computer" layout is in the mockup as the alternative.

Changes from the agreed direction, and why:

- **Above Search, not just above Projects.** The choice also scopes Search and the thread list, so
  it sits above everything it scopes, as a workspace switcher does in Slack and Linear. The Tasks
  and Agents nav rows stay all-computers (their pages already handle environments themselves).
- **All computers: merged lists, not repeated sections.** The thread list has shelves (Pinned,
  Active, Working, Snoozed, Settled), paging and drag and drop. Repeating them per computer is a
  large change in the hottest file of the app; merged lists only need a filter and a machine icon,
  which the sidebar already uses for projects ("Also on Mac Studio"). Bots, which is one section per
  computer today, gets machine labels instead of two bare "Bots" headers.
- **The badge shows only what needs the user.** Working runs elsewhere are listed in the menu but
  not on the closed switcher; awaiting input and approvals are.

## Data model today (0.0.37)

Environments ("computers" in UI copy):

- `apps/web/src/connection/catalog` holds catalog entries keyed by `EnvironmentId`. An entry's
  target is one of `PrimaryConnectionTarget` (the server that serves this client: on desktop, this
  Mac), `RelayConnectionTarget` (Up.computer Connect relay), `BearerConnectionTarget` (direct URL
  plus token) or `SshConnectionTarget`. `entry.enabled` marks disabled connections.
- `apps/web/src/state/primaryEnvironment.ts`: `primaryEnvironmentIdAtom` is the entry with the
  primary target.
- `packages/client-runtime/src/state/presentation.ts`: per-environment presentation (entry,
  connection phase, `serverConfig`) and summary atoms: `environmentIdsAtom`,
  `connectedEnvironmentIdsAtom`, `identitiesAtom` (id plus label), `environmentsAtom`,
  `machineByIdAtom` (laptop, desktop, mac-mini, mac-studio, server, cloud, linux, from
  `resolveEnvironmentMachineKind`). Web hooks wrap them in `apps/web/src/state/environments.ts`
  (`useEnvironments`, `usePrimaryEnvironmentId`, `useConnectedEnvironmentIds`,
  `useEnvironmentMachines`, `useEnvironmentIdentities`).
- Connection phase (`packages/client-runtime/src/connection/presentation.ts`): `available`,
  `offline`, `connecting`, `reconnecting`, `connected`, `error`, `unsupported`.
  `connectionStatusText` already has the copy ("Offline", "Update needed", ...).
  `EnvironmentMachineIcon.tsx` already maps machine kinds to icons.

Version and features:

- Too old to connect: protocol mismatch makes the phase `unsupported` ("Update needed")
  (`connection/compatibility.ts`). `connection/outdatedHostUpdate.ts` can update such a host over a
  bare socket, so the menu row can offer Update.
- Connected but older: `apps/web/src/versionSkew.ts` compares the client version with
  `serverConfig.environment.serverVersion`. Feature presence is probed per feature: tasks-web
  (`packages/tasks-web/src/environmentApi.ts`) asks once whether the server serves the Tasks RPC
  group, and Bots reuse that answer (`canReadAgents`). A server that serves Tasks but predates Bots
  therefore shows a "Bots" section whose `bots.list` call fails. That most likely explains the second
  "Bots" section with "Bot operation failed" in the screenshot (not verified against that computer). Phase 2 needs a real Bots probe (or a version floor) to show "Bots
  need a newer version" instead.

Projects, threads, bots:

- Every `Project` and `EnvironmentThreadShell` carries `environmentId`. Keys are
  `${environmentId}:${id}` (`scopedThreadKey`, `scopedProjectKeys`).
- The sidebar groups projects across computers into logical projects
  (`apps/web/src/sidebarProjectGrouping.ts`, `buildProjectGroups` with the primary environment
  preferred). A group has `memberProjects` from several environments;
  `ProjectEnvironmentBadge.tsx` shows the machine icon with "Also on <computer>".
- The Projects section (`apps/web/src/sidebarProjects/SidebarProjectsSection.tsx`) sets the
  sidebar project scope (`uiStateStore.sidebarProjectScopeKey`). "No project" is the primary
  environment's scratch project.
- Threads: `Sidebar.tsx` partitions all shells into shelves, filtered by `scopedProjectKeys`.
  Search uses `useConnectedEnvironmentIds()`.
- Bots: `packages/tasks-web/src/bots/Bots.tsx` renders one `EnvironmentBots` section per
  environment from `useBotEnvironmentIds()` (primary plus connected), each titled "Bots". Same in
  the compact sidebar (`CompactSidebarBots`, one pill per environment).
- Shell cache: the web client stores each environment's last shell in IndexedDB
  (`apps/web/src/connection/storage.ts`, `EnvironmentCacheStore`; shell status `cached`). An
  offline computer's projects and threads can be shown. Bots have no cache.

Counts available without server changes:

- Thread shells: `activityRunStatus` (`running`, `waiting`, ...) and `pendingRuntimeRequest`
  (approval or user input) per thread.
- Task runs: `packages/tasks-web/src/state/environmentRunCounts.ts` (`EnvironmentRunCountsStore`)
  already gives one environment's run counts over all tasks; `TaskNavigationRunCounts` sums it for
  the Tasks nav row. Running and `blocked` (Awaiting Input) are what the switcher needs.

## What the upstream sync (#45) changes

No environment filter or switcher arrives on the web. What matters for phase 2:

- **Sidebar split.** `Sidebar.tsx` goes from 5334 to 3389 lines: thread rows move to
  `components/sidebar/SidebarThreadRow.tsx`, drafts to `SidebarDraftBlock.tsx`, markers to
  `SidebarListMarkers.tsx`. Thread state moves into a `useSidebarThreads` hook that calls
  `partitionSidebarThreads({ threads, scopedProjectKeys, serverConfigs, ... })` and derives state in
  render instead of effects (#25234). This is the place to filter by computer. Build phase 2 on the
  synced code, not on 0.0.37.
- **Older settled threads load in pages per environment** (`olderSettledScopes(environmentIds,
scopedProjectKeys)`, #24723). The computer filter must narrow these environment ids too, or
  paging would fetch other computers' threads.
- **Route reveal** (`components/sidebar/routeReveal.ts`): navigating to a thread the project scope
  hides widens the scope to All. The computer filter should follow the same rule (switch to the
  thread's computer, or to All), in the same render-time resolution.
- **Presentations are stable now.** `EnvironmentPresentation.serverConfig` drops providers
  (`EnvironmentServerConfig`), presentations keep identity across provider pushes, and there is a
  new `serverConfigsAtom` (enabled environments only) and `presentationsWithProvidersAtom`. A
  switcher reading presentations will not re-render on every provider status push.
- **Related fixes:** new threads no longer hang when a project's computer is offline (#23967); SSH
  hosts on an older server explain the mismatch instead of reconnecting forever (#23647); adding a
  project to another computer takes you there (#22254).
- **Mobile already has it.** Upstream mobile has a thread list environment filter
  (`apps/mobile/src/features/home/ThreadListFilters.tsx`, `home-list-options.ts`
  `selectedEnvironmentId`): "All environments" or one environment, saved with the list options,
  falling back to All when the environment disappears. The iPad sidebar
  (`ThreadNavigationSidebar.tsx`) uses the same options.

## Mobile

A phone is never one of the computers, so "This Mac" has no meaning there and the default should
stay All. Mobile already filters by environment with upstream's menu. Recommendation: no new
switcher on mobile in phase 2. Later, small and optional: rename "environments" to "computers" in
that menu and add the same waiting counts to its rows. Bots on mobile follow whatever the upstream
filter selects.

## Open questions for the user

1. Placement: top of the sidebar above Search (proposed), or between the nav rows and Projects?
2. All computers: merged lists with machine icons (recommended) or grouped by computer (mockup
   frame 5)?
3. Should Tasks and Agents (nav rows and pages) follow the switcher too, or stay all-computers?
4. The "waiting elsewhere" badge: awaiting input and approvals only (proposed), or also failed runs?
5. Name of the primary computer when it is not this Mac: in a browser on app.t3.codes or a phone the
   primary is the server that served the page. Proposal: "This Mac" / "This PC" only in the desktop
   app, the computer's own name elsewhere.
6. Offline computer's bots: keep the last list in memory and dim it, or hide the section with "Bots
   load when Mac Studio is back"?
7. Keyboard shortcuts: Ctrl+1..9 for computers and Ctrl+0 for All? Check collisions with existing
   keybindings first.
8. Should an offline or too-old computer be selectable at all, or only listed with its status and
   actions?

## Phase 2 plan (after approval and after the 0.0.38 sync lands)

Steps, each shippable:

1. **Selection state.** `apps/web/src/state/sidebarComputer.ts`: saved choice (`EnvironmentId` or
   `all`, local storage key `upcomputer:sidebar-computer`), resolved against enabled catalog
   entries, falling back to the primary. `shown` when two or more enabled entries exist. Unit tests
   for fallback.
2. **Switcher UI.** `apps/web/src/components/sidebar/SidebarComputerSwitcher.tsx` with the
   existing `Menu` primitives, `EnvironmentMachineIcon`, `connectionStatusText`, `versionSkew`.
   Placed in the sidebar's fixed header above `SidebarThreadHeader`; compact pill in
   `CompactSidebar.tsx`.
3. **Filtering.** In `Sidebar.tsx` (post-sync): filter `projects` before
   `buildSidebarProjectSnapshots`, filter `threads` and the `serverConfigs` ids passed to
   `useSidebarThreads` / `olderSettledScopes`, and `searchEnvironmentIds`. New thread defaults to
   the selected computer. Extend `routeReveal.ts` to switch computers. "No project" resolves to the
   selected computer's scratch project. Logic tests next to `Sidebar.logic.test.ts`.
4. **Bots.** `useBotEnvironmentIds()` intersects with the selection; in All, label each computer's
   group. Add a Bots probe so an older server shows the update notice instead of an error.
5. **Counts.** Thread shell counts in web; task run counts from tasks-web through a product slot
   (tasks-web cannot be imported by `apps/web`), for example a per-environment counts accessory like
   the nav row accessory. Badge on the switcher for other computers.
6. **Copy and docs.** "Computers" wording, a short section in the user docs on connecting and
   switching computers.

Files touched: `apps/web/src/components/Sidebar.tsx`, `components/sidebar/routeReveal.ts`,
`components/sidebar/CompactSidebar.tsx`, `sidebarProjects/SidebarProjectsSection.tsx` (scratch),
new `state/sidebarComputer.ts` and `components/sidebar/SidebarComputerSwitcher.tsx`,
`product/ProductSlots.tsx` plus the extension API type for the counts slot,
`packages/tasks-web/src/bots/Bots.tsx`, `packages/tasks-web/src/environmentApi.ts` (bots probe),
`packages/tasks-web/src/feature.tsx`.

Risks:

- `Sidebar.tsx` is upstream's file and the busiest merge surface. Keep our logic in our own files
  and hook in with a few lines; do it right after the sync, not before.
- Project grouping merges a repository across computers. Filtering raw projects before grouping
  keeps groups correct, but a saved project scope may point at a group that disappears on another
  computer; `resolveSidebarProjectScopeKey` already clears missing scopes.
- Drag and drop, pins and active order are per thread and per environment; moving a thread between
  shelves while filtered must not reorder hidden threads.
- Notifications and links into another computer must switch the sidebar, or the open thread has no
  row.
- Feature detection for "older version" is per feature today; a Bots probe is new work.
- Performance: counts for every computer must come from existing streams (shell atoms,
  `EnvironmentRunCountsStore`), no polling, no extra subscriptions per row.

Estimate: about 3 days of agent work (state and switcher 0.5, filtering and route reveal 1, bots
and probe 0.5, counts slot and badge 0.5, compact sidebar, tests and polish 0.5), plus one
integrated pass in the desktop app with two computers connected.
