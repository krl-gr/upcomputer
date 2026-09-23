# Cooperative native ownership gate

`packages/shared/src/profileOwnership.ts` supplies an OS-backed **cooperative**
gate. It is not the complete offline lease required by the migration coordinator.
Automatic migration remains disabled.

## Mechanism

The permanent control file is
`~/.upcomputer-migrations/ownership-v1/ownership.sqlite`, outside both profile
roots and the migration job directory. It contains only a format/version row.
It is not an application database and stores no credentials or profile records.
The current entry points derive this control home from `os.homedir()` (including
its HOME override). Launchers must agree on it. Different HOME values that still
point at the same application profile are not coordinated by this gate; a full
native adapter must reject or resolve that topology. Fixtures override both HOME
and every application data path together, never just HOME against live data.

- Application owners retain a SQLite read transaction, with an actual SELECT to
  acquire a shared kernel lock. Multiple participating owners may coexist.
- Maintenance retains `BEGIN EXCLUSIVE` using SQLite's rollback-journal VFS.
  It cannot proceed while any participating application remains open; new
  application owners cannot proceed while maintenance holds the exclusive lock.
- WAL mode is rejected because its reader/writer semantics do not implement this
  exclusion. Busy/unavailable/invalid storage fails closed; there is no PID or
  timeout-based fallback.
- Process exit, including SIGKILL, releases the kernel locks. Never delete the
  file to reclaim ownership: replacing it creates a different lock object.
  `assertHeld` detects a changed inode, unsafe path or released transaction.
- Symlinks, multiply linked files, non-directory control paths, corrupt/foreign
  databases and unsafe POSIX ownership/write permissions are rejected. Native
  Windows ACL/filesystem behavior and network homes are not verified support.

This relies on local filesystem locking and the control file staying in place.
It is not protection against a privileged actor replacing mounts/files, nor an
advisory lock that every unrelated program will automatically honor.

## Application integration

Desktop acquires its application lease synchronously before Clerk storage or the
Effect runtime starts, and releases it on quit (or by OS process cleanup).
Backend server/auth/project/connect/service CLI operations acquire a lease before
resolving config or opening application state. Their outer command Scope retains
it through server/agent/database finalizers. Confirmed project-config migration
also participates; read-only inspection does not create a gate.

Backend and desktop hold independent shared leases: closing the desktop does not
release a still-running backend's lease. CLI help/argument parsing and pure
config-resolution tests do not acquire ownership. A program embedding server
layers without these CLI entry points must supply the equivalent lifetime guard;
this change does not silently turn every low-level repository API into an owner.

The existing durable migration-journal fence is still required. Kernel locks
alone vanish on a crash; a pending journal must continue blocking startup until
recovery completes.

## What this does not solve

Old Alpha binaries, standalone provider tools, unmanaged/detached descendants,
and unrelated Git processes do not use this gate. Holding its exclusive lease is
**not evidence that all such writers have stopped**. It is intentionally not
installed as the coordinator's `acquireOfflineLease` implementation.

Native activation still needs tested old-launcher/owner retirement and process
lifetime handling, external Git ownership, OS encrypted-catalog validation,
complete state/reference coverage and a post-activation restore procedure. No
live profile has been moved or restored by this pass. The working Alpha and the
retained human-test dev were not stopped or restarted.

## Verification

- Real child processes prove shared/exclusive contention, release after the last
  owner, crash release without PID-file removal, and rejection after lock-file
  replacement. Effect tests verify command-scope cleanup after failure.
- The built backend refuses maintenance before creating profile state, holds a
  shared lease while serving, and releases it after shutdown.
- Actual macOS Electron refuses startup while a separate Node process owns the
  exclusive lease. Its fixture sets every Electron data path to a disposable
  home and replaces public crypto methods with throwing sentinels: this tests
  startup exclusion, **not** OS encryption or a full installed-app upgrade.
- No working credential, OS keychain entry or application profile was used as
  test data. A separate OS user/VM is needed for the next encryption/restore
  validation; there is no need to export keys or share passwords.

Full restoration remains distinct from kernel exclusion. In particular, the
current Git participant snapshots backlinks, not a complete post-upgrade Git
index/ref/object history. Newer profiles and external repository changes must be
preserved and reviewed before selecting a restore target. Blindly copying an old
profile or rewinding an external repository is not a supported restore procedure.

A future maintenance/recovery entry point must be separate from normal application
startup: stop owners first, then acquire exclusive ownership, and retain it across
all verification/publication/restore steps. It must not try to upgrade a shared
application lease in place. The ordinary desktop entry deliberately cannot open
its normal UI while a durable migration needs recovery.

The later [macOS Tart validation](native-profile-macos-validation.md) covers native
catalog encryption in a separate guest. It does not broaden this gate's ownership
coverage or replace the remaining complete-profile/restore requirements.
