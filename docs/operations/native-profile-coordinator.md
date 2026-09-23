# Native profile migration: coordinator foundation

## Status and safety boundary

Implemented: an **offline library engine**, durable journal ordering, verified
backup/candidate copies, process-crash recovery, pre-activation rollback, and
startup fencing. **Not activated:** no production CLI, startup migration trigger,
native ownership adapter or complete data-reference adapter is provided yet.
The mandatory adapter methods deliberately have no default implementations.
A [cooperative native ownership gate](profile-ownership.md) now protects new
desktop/CLI owners. It does not exclude old binaries or arbitrary external Git
processes and is not substituted for the complete offline lease.

The installed Alpha, working profiles, running agents and retained human-test
dev were not migrated or restarted. Tests used newly created disposable homes,
synthetic records and synthetic SQLite files. No working credentials were used.

## Source audit (not a census of the working profile)

| State / boundary                      | Owner and migration requirement                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend root                          | `server/config.ts` derives `userdata` or `dev`, `state.sqlite`, attachments, settings, logs, secrets, caches and worktrees. Preserve both state namespaces and their IDs, including SQLite sidecars.                                                                                                                               |
| Earliest desktop initialization       | `desktop/main.ts` constructs Clerk storage synchronously, before the Effect application starts. The fence runs **before** that construction. Checking only `whenReady` is too late.                                                                                                                                                |
| Desktop environment / browser profile | `DesktopEnvironment.ts` and `DesktopAppIdentity.ts` resolve a separate Electron userData root. Platform candidates include `t3code`, `T3 Code (Alpha)` and the dev equivalents. Both backend and browser selection must agree with the journal.                                                                                    |
| Encrypted desktop connection catalog  | `DesktopConnectionCatalogStore.ts` stores `connection-catalog.json` **under backend state**, while encryption depends on Electron/OS identity. Copying either root alone is insufficient evidence of decryptability. Never export keys or print decrypted records.                                                                 |
| Clerk and browser databases           | Clerk storage uses backend state; Electron holds Chromium storage, cookies, IndexedDB and potentially OS-crypto metadata. The earlier browser IndexedDB migration does not replace this native operation.                                                                                                                          |
| Provider resume state                 | `ProviderSessionRuntime.ts` persists `resume_cursor_json` and `runtime_payload_json`. Pi session cursors include absolute `sessionFile` references, and sessions normally live in `provider/pi/sessions`. Provider-instance credential directories and externally configured agent/session locations need explicit classification. |
| Project/attachment/session references | Rewrite audited structured fields only. Do not globally replace strings in chat transcripts, task descriptions, user project files, arbitrary JSON or encrypted payloads. External workspace paths must remain external.                                                                                                           |
| Managed Git worktrees                 | `GitVcsDriverCore.ts` uses `worktreesDir` under the backend root. Git also maintains backlinks in the original repository's `.git/worktrees` outside that root. A directory copy alone does not repair these relations.                                                                                                            |
| Owners                                | Backend `server-runtime.json` includes a PID, but missing/stale records do not prove quiescence. Electron single-instance acquisition currently happens in Clerk configuration, after early storage construction. Agents, terminals and old binaries need native maintenance coordination.                                         |

Worktree backlink repair is an **additional transaction participant**, not a
string replacement inside the copied profile. `profileGitWorktrees.ts` now
implements that participant for standard, absolute linked-worktree pointers.
It snapshots external backlinks before publication, commits them only after
candidate roots are published, and restores them before rollback quarantines
those roots. Candidate preparation still cannot mutate external repositories.
The native offline lease must cover these external repositories as well as the
profile roots; the participant does not claim that a PID check provides that lease.

## Engine and commit protocol

Implementation: `packages/shared/src/profileMigration.ts`.

A caller supplies one or two distinct roots (`backend`, `electron`) and an
explicit control directory. The standard location is
`~/.upcomputer-migrations/profile-v1`. A production caller must use that account's
standard directory: startup guards do not discover arbitrary job locations.
Roots and the control directory cannot
nest; case-only distinctions and existing filesystem aliases are rejected
conservatively. Destination parents must exist; publication must stay on the control
volume. Any existing destination, even an empty directory, is a conflict, not
permission to merge or overwrite it.

1. Acquire the job mutex. A known live PID, uncertain owner, native singleton
   marker or live backend record stops the operation. Missing owner markers
   **do not** replace the required native offline lease.
2. Acquire the supplied native lease, which must exclude every old/new writer
   throughout preparation, publication and validation. Its continued ownership
   is checked again before publishing each root.
3. Write the `copying` journal with normalized plan identity and source digests.
   Copy originals into `backup/<id>` and verify byte/tree equality. Copy backups
   into `candidate/<id>`. Originals are never rewritten or deleted.
4. Run the required candidate preparation and validation. Persist candidate
   digests and `prepared`. Source/backup/candidate changes fail closed.
5. Persist `publishing` **before** moving any candidate to its destination.
   Each directory rename is flushed on supported POSIX filesystems. A restart
   can recognize mixed staged/published roots by their recorded digests; merely
   finding a directory is not success.
6. Replay the versioned external participant's commit, if present, then validate
   the published candidates, confirm digests and lease ownership, and persist
   `complete`. Only this journal state permits normal startup.

Jobs with an external participant use journal **version 2**, so older version-1
engines reject them instead of silently skipping external repair. The participant
ID is persisted and must match on resume/rollback. Validation receives a
`candidate` or `published` phase: only the latter may require final backlinks.

Files and directory metadata are flushed in order, including creation of the
journal's parent directories. Windows directory fsync is not available through
this Node API. Power-loss guarantees, filesystem/ACL semantics and native
Windows behavior remain release gates; SIGKILL tests are not power-cut tests.

Hashes are streamed; journal metadata contains paths/digests, not profile
contents or decrypted credentials. Root copies are created privately; nested
file permissions, including read-only files, are preserved. Symlinks, hardlinked
files and special files are rejected rather than followed. A production adapter
must explicitly address any legitimate unsupported profile entries.

The engine requires roughly two additional full copies (backup and candidate),
plus retained interrupted attempts. Space exhaustion/permission errors must not
trigger fallback to a fresh profile. No automatic backup pruning is implemented.

## Recovery and rollback

- `copying`: unchanged originals allow rebuilding interrupted candidates from
  verified backups. Partial copies are renamed aside, not deleted.
- `prepared` / `publishing`: validate recorded candidates and resume publication
  without repeating structured rewrites.
- Job owner died: one recovery contender can retire an unambiguously dead
  owner's mutex. A missing/corrupt owner file, reused/live PID or interruption
  while reclaiming the mutex requires explicit maintenance review; age alone
  never grants permission to steal a lock.
- `rollbackProfileMigration`: available only before `complete`. Verify original
  sources and any published candidates, record `rolling-back`, restore external
  references, and then quarantine published candidates under the job directory. Originals remain in place.
  Interrupted rollback resumes as rollback, not as forward migration.
- `complete`: repeat is non-destructive. New activity in the destination is not
  overwritten. Automatic rollback is refused; restoring a pre-upgrade backup
  after use requires separately preserving newer data and explicit review.

The startup fence is used by early desktop initialization, desktop environment/
userData resolution, and backend base-directory resolution. It rejects missing
committed destinations and ambiguous/pending control state. On completion,
exact old root overrides are redirected to the committed destination; arbitrary
descendant paths are not rewritten.

Old binaries do not understand this fence. Retaining the original source is a
rollback aid, **not** support for running both copies concurrently. Retirement
of old launchers/process owners remains part of the native activation design.
Do not delete a journal or reinstall an old binary to bypass maintenance.

## Verification in this implementation pass

- 45 focused public tests: coordinator, desktop identity/environment and backend
  config/startup resolution. Includes real killed subprocesses at three journal
  phases, job contention, lost lease, changed sources/backups/candidates/plans,
  conflicts, invalid owner/journal state, rollback interruption, read-only files,
  control-directory symlinks, and a real SQLite structured-rewrite fixture.
- 17 focused bundled agent/task regression tests.
- Actual composed backend: refused a pending migration before creating/opening
  profile state; after commit, an old explicit home override opened only the new
  fixture database. Output/pairing URLs were not emitted by the verifier.
- Actual macOS Electron entry: refused pending migration before Clerk/backend
  initialization. The test intercepted the error dialog and made OS crypto
  methods throw if called, so it did **not** test safeStorage decryption or a
  full native upgrade. Every Electron runtime directory was isolated.
- Shared/server/desktop types, changed-source lint/format, composed backend and
  desktop code builds are checked. This is not an installed-artifact upgrade.

Opt-in integration probes, after the respective builds (Node 24):

```sh
UPCOMPUTER_TEST_NATIVE_PROFILE_GUARD=1 node --test scripts/profile-migration-startup.desktop.test.mjs
UPCOMPUTER_TEST_SERVER_ENTRY=/absolute/path/to/built/bin.mjs node --test scripts/profile-migration-startup.server.test.mjs
```

Before activating relocation, implement native old/new ownership leases and
profile discovery/conflict handling, finish audited SQLite/provider/worktree
participants, validate OS-encrypted catalog/key retention with real isolated
Electron identities, and test fresh install, 0.0.31 upgrade, interruption,
restoration and downgrade on macOS and Windows. Only then schedule maintenance
of the working profile with its owner. No live migration is implied by this pass.

## Structured-reference participants (follow-up)

`packages/shared/src/profileGitWorktrees.ts` discovers standard linked worktrees
under the owned backend `worktrees` directory. Its immutable `git-worktrees.json`
records exact old/new backlink contents. A backlink already at the requested
value is a replay, not another rewrite. Any independent change is a conflict;
neither forward progress nor rollback overwrites it. Reciprocal Git
pointer relationships and candidate `.git` files are rechecked. No Git hooks or
commands are executed by the participant itself.

Relative Git pointers, embedded main repositories, symlinks, nonstandard common
directories and unclassified entries require review. Original worktree copies
remain rollback material, not concurrently usable worktrees sharing one index.
Native locking/retirement of old owners is still required before activation.

The bundled Pi participant rewrites only selected runtime cursor/cwd fields and
version-3 session headers in the copied candidate. Message bodies are streamed
without modification. A combined disposable fixture verifies actual Git linkage,
SQLite references and SDK session reopening, without sending a model request.
This does not cover all project/orchestration/provider reference formats.

Follow-up verification: **50 focused public tests**, **23 bundled regression and
participant tests**, including interrupted external repair/rollback, foreign
backlink conflicts, missing participant recovery, large session bodies, external
session refusal and a cold WAL left by a killed fixture process. The two opt-in
backend/macOS Electron startup probes remain the integrated startup checks;
they are not OS encryption round-trip or installed Windows upgrade evidence.

The backlink snapshot is sufficient only for the **pre-activation** rollback
covered here, while the lease excludes Git activity. It is not a complete
post-activation Git backup (indexes, refs and objects can subsequently change).
A full restore/downgrade procedure must separately preserve/reconcile external
repository state and newer worktree changes; restoring only the profile tree
or only the saved backlink must not be advertised as a complete rollback.
