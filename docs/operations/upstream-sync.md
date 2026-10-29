# Upstream sync

Up.computer is upstream T3 Code (`pingdotgg/t3code`, remote `upstream`) with our product on top. A
sync merges `upstream/main` into a `sync/upstream-<date>` branch, fixes what broke, and lands on
`main` through a pull request.

## Cadence

Sync every 3 to 4 days, and right after each release cut. Conflicts grow with the gap: 10 days cost
331 conflicted files, 5 days about 100. A long gap can be split into stages at upstream commits that
change a lot at once (a test purge, a comment rewrite), one merge commit per stage.

## Merging

- Merge commits are named `chore(sync): merge upstream t3code <sha> (...)`, and the sync pull request
  is merged with a merge commit, never squashed. The relay deploy relies on that subject (see below),
  and later syncs need upstream's history.
- Commit the merge with its conflict resolutions only, then each fix as its own commit.
- After the merge: regenerate `apps/web/src/routeTree.gen.ts` and the lockfile, then run
  `node scripts/apply-branding.ts` and `node scripts/check-branding.ts` ([branding](../branding.md)).
- Re-check the product hooks: `git grep -n -e productFlags -e whenProductFeature -e
  isProductFeatureShown -e productSurface` ([product flags](../internals/product-flags.md)). A new
  upstream entry point to a hidden feature gets the same gate.
- Before landing, merge current `origin/main` into the sync branch.

## Conflict policy

| Area                                                                               | Take                                                                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Our own packages and folders (`tasks-*`, `computer-use-*`, product surfaces, bots) | Ours.                                                                                                                               |
| Lines that differ only by branding                                                 | Upstream's, then `apply-branding`.                                                                                                  |
| Upstream copy rewrites (tool descriptions, agent instructions, comments)           | Upstream's, keeping our product changes in it.                                                                                      |
| Our product hooks inside upstream files                                            | Upstream's code with our hook re-placed, also when upstream moves the code to a new file.                                           |
| `release.yml`, `ci.yml`, `deploy-relay.yml`, marketing site, telemetry key         | Ours; port only the upstream fixes we want.                                                                                         |
| Other upstream workflows                                                           | Upstream's, verbatim. One that would run here gets a `github.repository == 'pingdotgg/t3code'` guard rather than a deletion.        |
| Mobile (`apps/mobile`, outside our workspace)                                      | Upstream's.                                                                                                                         |
| Upstream deletes a test file we changed                                            | The deletion; our cases move to a `*.upcomputer.test.ts` file of ours.                                                              |
| Upstream's new lint or Effect diagnostics fail our code                            | Fix it, or put the file on the UpComputer burn-down list in `vite.config.ts` and our effect counts in `scripts/effect-budget.json`. |

Keep our tests in our own `*.upcomputer.test.ts` files and our code in our own folders: those never
conflict.

## Relay

`deploy-relay.yml` deploys the production relay on every push to `main`, except a push that brings a
`chore(sync): merge upstream` commit. Upstream's relay changes then wait for a manual run of the
workflow on `main`, once the configuration they need is in place. Check the relay diff of the sync
(`git diff origin/main -- infra/relay`) for new variables, secrets, migrations and placement before
that run.

## Verification

Per-package typecheck, `vp run knip:check`, `check-branding`, lint of the files that differ from
upstream, the focused suites of the areas the merge touched, then a nightly from the branch and a
Release QA pass in a VM before the pull request lands.
