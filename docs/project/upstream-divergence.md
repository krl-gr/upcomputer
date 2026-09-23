# Upstream divergence registry

Every place this fork deliberately differs from `pingdotgg/t3code`, why, and
what that costs at the next sync.

Read this before resolving an upstream merge. Without it the same decisions get
re-litigated from scratch, and — worse — a silent auto-merge quietly reverts one
of them without producing a conflict marker.

**Last sync:** 2026-07-27, tag `vendor/upstream-2026-07-27` (`23ea08daf`), 196
commits. Merge commit `5eb641413`.

## How to run a sync

1. `git fetch upstream`, pick a **fixed sha** and tag it `vendor/upstream-<date>`.
   Do not merge a moving `main`: upstream lands ~13 commits a day and the base
   will shift while you work.
2. Branch from the current release branch, never from `main`.
3. Resolve cold first (server, contracts, shared, scripts), then mechanical
   (assets, marketing, lockfile), then `apps/web`.
4. **Re-read "Silent auto-merges" below and grep for each listed symbol.** Those
   reverts arrive without conflict markers; `vp lint` finding a newly unused
   import is often the only signal.
5. Gates: `vp run typecheck`, `vp lint`, `vp run test`,
   `node scripts/check-public-boundary.ts`, desktop smoke.

## Always ours, resolve mechanically

| Zone                                          | Rule                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/marketing`                              | `git checkout --ours`. Their marketing site is not wanted in any form.                                                                                      |
| `assets/prod`, `assets/nightly`, `assets/dev` | Ours. Their `black-*` / `t3-black-*` / `nightly-*` families stay in the tree **unused** — deleting them turns the next branding refresh into modify/delete. |
| `apps/web/public/favicon*`                    | Ours.                                                                                                                                                       |
| `apps/web/src/index.css`                      | Theirs, byte for byte. Our divergence lives in `theme.upcomputer.css`, imported at the end. Never edit `index.css`.                                         |

Upstream marketing files that become **live Astro routes** are dropped, not
merged: `legal.astro`, `privacy-policy.astro`, `security-policy.astro`,
`terms-of-service.astro`, `schema/t3.json.ts`. Merging them would publish
t3code's terms of service on up.computer next to ours.

## Product decisions

| #   | Zone                          | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sidebar v2 (#4026)            | Merged whole and wired as a third view mode, but **parked** in the client (`FLAT_VIEW_ENABLED` in `AppSidebarLayout`). `SidebarViewMode` stays `nested \| focused \| v2` — dropping the literal would break decoding for anyone who already selected it. Upstream's `sidebarV2Enabled` is removed so one field holds the state.                                                                                                                          |
| 2   | View switcher                 | One-click toggle between Classic and Focus. The three-item menu was reverted: the switcher lives inside the v1 sidebar, which v2 replaces wholesale, so selecting Flat view removed the only way back. A stored `"v2"` reads as Classic and one click writes `nested`, so it self-heals.                                                                                                                                                                 |
| 3   | `BetaSettingsPanel`           | Their "Sidebar v2" switch removed — the View menu is the only entry. Auto-settle rows stay, gated on `sidebarViewMode === "v2"`.                                                                                                                                                                                                                                                                                                                         |
| 4   | Surface grain                 | Off. `--surface-grain: none` in our theme kills both `body` and the `surface-grain` utility, web and Electron.                                                                                                                                                                                                                                                                                                                                           |
| 5   | Sidebar surface               | Ours: `.t3-sidebar-glass`, blur 28px. Not their flat `bg-sidebar`.                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Sidebar row tokens            | Their token **names** (`--sidebar-row-hover/-active/-selected`, `--sidebar-control-surface`, `--sidebar-muted-foreground`), our **values** — all pointed at `--sidebar-accent`. Must be restated in the dark block: their dark values sit behind the `dark` variant and outrank a plain `:root`.                                                                                                                                                         |
| 7   | `data-sidebar-version`        | **Never set it.** It is not a styling hook — `index.css` hangs a full palette override plus an opaque `background-color` on it, scoped to the sidebar element, which beats our `:root` tokens by inheritance. Our hook is `data-sidebar-mode`.                                                                                                                                                                                                           |
| 8   | Sidebar chrome                | `sidebar/SidebarChrome.tsx` is rewritten with our header and footer under upstream's two export names, so `SidebarV2.tsx` imports it unmodified. Their stage-channel artwork, brand wordmark and update pills are not used.                                                                                                                                                                                                                              |
| 9   | Stage-channel artwork (#4130) | Rejected in the sidebar and the composer send button. Still present on the T3 Connect CLI auth screen (`AuthSurfaceShell`), which is their surface and nightly/dev-only.                                                                                                                                                                                                                                                                                 |
| 10  | Thread row styling            | Ours: primary-tinted selection (`bg-primary/22` / `/15`), not their neutral `sidebar-row-*`. Selection stays distinct from hover.                                                                                                                                                                                                                                                                                                                        |
| 11  | Sidebar typography            | Ours (`SIDEBAR_LABEL_TEXT_CLASS`, 14px), not their `text-xs …/75`.                                                                                                                                                                                                                                                                                                                                                                                       |
| 12  | Project sort menu             | Not taken. The settings it writes (`sidebarProjectSortOrder`, `sidebarThreadSortOrder`, `sidebarThreadPreviewCount`) **are** honoured by our sidebar — we simply have no UI for them. Revisit if that gap matters.                                                                                                                                                                                                                                       |
| 13  | Project status dot            | Behind a temporary localStorage flag (`components/sidebar/experiments.ts`), off by default, switchable in Settings → Beta → Experiments. Delete the flag and the losing branch once decided.                                                                                                                                                                                                                                                             |
| 14  | Thread context menu           | Both "Fork thread" (ours) and "New thread on {branch}" (theirs).                                                                                                                                                                                                                                                                                                                                                                                         |
| 15  | New-thread seeding            | Ours: the `+` on a project row seeds branch / worktree / env mode from the thread you are viewing. Upstream deliberately removed this in favour of configured defaults.                                                                                                                                                                                                                                                                                  |
| 16  | Chat header                   | Ours, including the `showHeaderControls` prop the workspace panels depend on.                                                                                                                                                                                                                                                                                                                                                                            |
| 17  | Composer                      | Our shell (`rounded-[32px]`, `bg-card`) plus their drag-over tint. Our control row. Their command-menu layer taken.                                                                                                                                                                                                                                                                                                                                      |
| 18  | User message bubble           | Ours.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 19  | Branch toolbar strip          | Ours. Upstream's "reuse previous worktree" affordance and environment indicator are wired but **not surfaced** by our layout — port them into our markup if wanted.                                                                                                                                                                                                                                                                                      |
| 20  | Changed files card            | Their `ChangedFilesCard` extraction and expand API, our surface (`bg-card/40`, glass sticky header).                                                                                                                                                                                                                                                                                                                                                     |
| 21  | Index route                   | Opens a draft in the most recently active project, then renders `null`. Upstream's draft hero and view transitions are not taken: here the draft surface belongs to `ChatWorkspace`, not to the route.                                                                                                                                                                                                                                                   |
| 24  | Draft hero (#4055)            | **Parked** in `ChatView` (`DRAFT_HERO_ENABLED`). An empty draft keeps the composer docked at the bottom and the timeline's "Send a message to start the conversation" placeholder, as before the sync. The layout underneath is fixed, so flipping the flag gives a correct centred stack — what is missing is content, not CSS: `chat/DraftHeroHeadline` is unused, and the glass shell and context strip it centres around are both declined (see 17). |
| 22  | `apps/mobile`                 | Taken as is, zero divergence. Keep it that way — it merges free.                                                                                                                                                                                                                                                                                                                                                                                         |
| 23  | T3 Connect sidebar sign-in    | Taken. It self-gates on `hasCloudPublicConfig()`, which reads _our_ build-time Clerk and relay config, so it is the client half of the cloud we intend to run ourselves.                                                                                                                                                                                                                                                                                 |

## Silent auto-merges — check these every sync

Upstream changes that landed in our zones **without a conflict marker** during
the 2026-07-27 sync and had to be reverted by hand. Each is a live risk next
time: grep for the symbol, do not trust the absence of markers.

| What                             | Symptom                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createThreadForProjectMember`   | Our thread seeding replaced by "always configured defaults". Only trace: two unused imports.                                                                                                                                                                                                    |
| `ChatComposer` placeholder chain | Lost the `environmentUnavailable` branch and its `disabled` guard — the composer stayed enabled against a disconnected environment.                                                                                                                                                             |
| `ComposerPrimaryActions`         | `StageBackdropButtonArt` rendered under our send button on nightly/dev.                                                                                                                                                                                                                         |
| `ProjectFavicon`                 | Our fallback detector still matched a filename that the server no longer emits, so projects without a favicon lost the coloured avatar. Caused by taking their `AssetAccess` refactor in the cold layer.                                                                                        |
| `scripts/lib/brand-assets.ts`    | Nightly paths silently moved from our `blueprint-*` to their `nightly-*`.                                                                                                                                                                                                                       |
| `OpenCodeAdapter` session title  | The reverse case: we _kept_ our forced title and suppressed upstream's auto-generated thread names. Their behaviour is better; taken.                                                                                                                                                           |
| `isDraftHeroState`               | The draft hero landed in `ChatView` although decision 21 declined it on the index route — two halves of one feature, only one of them a conflict. Every new tab centred a bare composer, and our branch toolbar, a sibling upstream does not have, sat _beside_ it in the flex row. Now parked. |

## Structural notes

- **A mode switcher must not live inside the thing it switches.** The view
  control sat in `Sidebar.tsx`; `AppSidebarLayout` swaps that whole component
  for `SidebarV2`, so picking Flat view deleted its own escape hatch. The fix,
  when Flat view comes back, is to move the control into
  `sidebar/SidebarChrome.tsx` — already ours and already rendered by **both**
  sidebars, so it costs nothing in `SidebarV2.tsx`.
- **Crossed hunk sides produce nonsense, not conflicts.** In
  `SettingsSidebarNav.tsx` upstream's hunk styled the _icon_ and ours styled the
  _label_; resolving to theirs put `size-4 shrink-0` on the label span and the
  first nav item ("General") clipped to "G..". Typecheck and lint both pass on
  that. When two sides of a hunk describe different elements, resolve by
  element, not by side.

- **Diff against `<merge>^1`, never against `HEAD`.** Once the merge is
  committed, `git show HEAD:<file>` is the merged file, so "identical to HEAD"
  proves nothing about what changed. The draft hero was diagnosed as
  pre-existing on exactly that mistake; `git diff 5eb641413^1 5eb641413 -- <file>`
  showed it as a pure addition.
- **A feature can arrive in halves.** Only one half of #4055 produced a
  conflict, so declining that half in the registry left the other half merged
  and live. When rejecting an upstream feature, grep for its symbols across the
  whole tree, not just the conflicted files.
- **Migration numbering.** Our migration 33 (`ProjectionThreadContext`) shipped in
  Alpha 0.0.29. Upstream's 33/34 pair was renumbered to 34/35. Any future
  collision must be resolved the same way — never renumber ours.
- **Case-clashing modules.** `sidebar/SidebarChrome.tsx` (upstream) and our
  layout helper cannot both be called `sidebarChrome`; ours is
  `sidebarChromeLayout.ts`. On a case-insensitive filesystem TypeScript resolves
  the `.ts` first and the import silently points at the wrong module.
- **`scripts/export-brand-icons.ts` is a trap.** It regenerates icons from
  upstream's Icon Composer projects into our production paths. Running it
  replaces the Up.computer artwork with t3code's.

## Open follow-ups

- **Branding sweep.** "T3 Code" is still user-visible in ~15 places
  (`ConnectionsSettings.tsx`, `connection/platform.ts`, the Codex `runtime_info`
  block, `t3 service` CLI copy). Independent of any merge; worth one pass with a
  shared constant.
- **Pre-existing lint error.** `apps/server/src/provider/Layers/CodexSessionRuntime.test.ts`
  uses `Effect.runSync` under `t3code/no-manual-effect-runtime-in-tests`. Ours,
  predates this merge.
- **`apps/mobile` doc comment** still refers to the removed `sidebarV2Enabled`.
  Left alone on purpose: mobile currently has zero divergence.

## Targeted backend OOM backport (2026-09-21)

Branch `fix/backend-oom-reconnect` adapts the following upstream fixes without
advancing the full upstream baseline or importing newer UI/pagination features:

- `ca72e381c` (#5147): bounded reconnect replay and lightweight CLI/HTTP snapshots.
- `7e460f429` (#8992): 8 MiB replay preflight; locally includes metadata bytes too.
- `08463e2c4` (#10777): cursor pagination releases consumed replay pages.
- `108f295cc` (#9715): per-subscription item/byte budget, including unacknowledged
  delivery; cancels producers when a slow client exceeds the budget.
- `7e4ce3bbb` (#8368) with the #9715 budget integration: thread subscriptions use
  `ThreadLiveEventCoalescer`, which keeps the newest `tool.updated` per stable
  tool-call id within a 50 ms window. The `ActivityPayloadProjection.ts` part is
  not taken because our projection lacks the snapshot tool-update dropping it edits.
- `ce4712d5b` (#9799), server live-stream parts only: shell queues retain event
  identity only, and the thread coalescer retains projected payloads. The
  `http.ts` static-asset caching and all client changes are not taken.
- `71c6f8248` (#6153): most recent 500 activities plus unresolved approvals/input.
- `a9ffb8279` (#9000): client snapshot activity projection in batches of 25 and
  short preview strings that do not retain full tool outputs.

These are adaptations, not wholesale cherry-picks. No database migrations or
stored history deletion. Full tool payloads remain in persistence. Global event
replay is still used for small ranges but is bounded by both cursor gap and bytes;
thread-specific SQL replay (#9726) is a separate follow-up.

Backend logs now emit numeric `backend memory sample` counters every 60 seconds,
and `backend memory pressure` at 80% of the V8 heap limit. No heap dumps or payload
logging are enabled. Replay byte-budget and live-buffer overflows log counts only.

Focused verification includes stale/ahead reconnect cursors, captured replay
head, byte preflight, slow-client ACK stalls and recovery, pending-action retention,
large snapshot tool output projection, and V8 page-lifetime checks. The lifetime
regression fails against the original recursive replay and passes with pagination.
