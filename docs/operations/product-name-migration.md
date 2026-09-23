# Product-name migration

This is a staged migration, not a global replacement of every `T3` token.
Upstream license/copyright notices and historical attribution remain intact.

## Inventory and boundaries

| Area                                                  | Strategy / status                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop package/publisher/update cache                | Already branded `upcomputer` / `Up.computer`; stable appId                                  |
| Public workspace packages, imports, aliases, bundlers | `@upcomputer/*`, mirrored in private optional peers/resolvers                               |
| Lint plugin directory, package, rule IDs              | `oxlint-plugin-upcomputer`, `upcomputer/*`                                                  |
| Server CLI package/bin and help                       | `@upcomputer/server`, primary `upcomputer` bin; `t3` remains a launch alias                 |
| DOM/CSS/internal browser event names                  | Dockview/composer classes and browser events renamed together                               |
| Browser UI preferences/drafts/workspace state         | `upcomputer:*` keys; 16 explicit legacy aliases in `legacyUiStorage.ts`                     |
| Environment variables                                 | Core server/desktop/telemetry config supports `UPCOMPUTER_*`; remaining emitters pending    |
| Checked-in project config                             | Prefer `upcomputer.json`; accept existing `t3.json` without running both                    |
| Desktop/server home and profile directories           | Existing data must remain discoverable; no rename while another process may own the profile |
| IndexedDB authentication/connection stores            | Security-sensitive, asynchronous migration; must preserve keys and connections              |
| Mobile application IDs, URL schemes, native modules   | Separate platform migration; package namespace does not change installed app identity       |
| Relay/deployment resource IDs and hosted URLs         | External contracts; never rename live infrastructure via text replacement                   |
| Telemetry event/property names                        | Dashboard compatibility, not display branding                                               |
| Vendored sources, licenses, historical docs/URLs      | Preserve attribution and real external URLs                                                 |

The two repositories must be updated together. The private compiler aliases,
optional peer names, Node test resolver, and bundler internal-package lists all
follow the public namespace. A previous private checkout is not source-compatible
with the renamed public packages.

## Verification record: namespace stage

- Frozen-lockfile, offline installs succeeded in both repositories, without
  dependency lifecycle scripts or dependency version upgrades.
- Public web/server/desktop and private task-server/agent-runtime typechecks pass.
- Mobile typecheck currently reports 65 navigation typing errors. An isolated
  snapshot of the pre-migration mobile sources, resolving the same dependencies,
  reports **byte-for-byte identical diagnostics**. Do not report this as a passing
  mobile typecheck or hide those baseline failures.
- Focused lint-plugin, packaging, shared-shell, sidebar, Pi and task-tool tests pass.
- Composed private server bundle builds with the new internal-package namespace.

## Verification record: browser UI state

- 176 focused storage/theme/draft/workspace tests pass, including quota failure,
  new-value precedence, repeated migration and deletion without resurrection.
- Migration copies bytes before removing an old key. Failed writes leave the
  original readable. Only an explicit non-auth allowlist is migrated.
- The pre-React theme bootstrap reads the new key first, then the legacy theme.
- An isolated paired browser verified an unsent draft and dark theme surviving
  a legacy-key migration and reload, without sending a model prompt.
- The rendered workspace regression checks still pass after the CSS rename.
- IndexedDB/OAuth identifiers are deliberately not covered by this UI migration.

Native installed-app upgrade and platform checks remain release gates. A browser
or a macOS bundle check is not evidence of a working Windows/mobile migration.

## Verification record: core environment boundary

Server CLI configuration, desktop configuration and telemetry now read
`UPCOMPUTER_*`, with `T3CODE_*` fallback only when the primary name is absent.
Invalid primary values fail rather than silently selecting the legacy value.
The Effect adapter preserves injected/nested ConfigProviders and does not mutate
process.env. Build-time public config normalizes each source separately, retaining
process > .env.local > .env precedence and legacy renderer aliases.

The old variables are still accepted. Remaining launch-script/provider/cloud
emitters are not yet globally renamed; do not assume every old environment
variable has already gained a new spelling. Build-time constants and local shell
capture markers use `__UPCOMPUTER_*` on both producer and consumer sides.

76 focused configuration, shell and sidebar checks pass. The real composed server
was launched on a disposable profile with conflicting old/new ports and homes;
it selected the new port/home and did not create the legacy home. Browser storage
and workspace checks pass together when run sequentially (`--test-concurrency=1`)
against one paired disposable browser. The verifier uses its own Vite cache to
avoid invalidating a retained human-test dev server's optimized dependencies.

## Verification record: CLI package

The workspace server is `@upcomputer/server`, with `upcomputer` as its primary
executable and `t3` as a compatibility alias pointing at the same entry. CLI help
uses Up.computer/UpComputer Connect. Build and publish filters reference the new
workspace name. No npm publication or cloud deployment was performed; publication
permissions and distribution of the new package name are separate release gates.
The relay workspace package is `@upcomputer/relay`; deployed resource IDs are not
renamed. Existing background-service identifiers are intentionally unchanged.
51 focused CLI/configuration/service/project/release-version tests pass.

## One-way transition policy

The target is a single UpComputer environment, not permanent dual naming. Legacy
inputs belong in explicit migration/compatibility modules. The final bridge
release and the supported upgrade window have not yet been assigned. Removing
these modules requires verifying the maintained profiles have migrated; older
installations must then upgrade through the bridge release. Attribution and
licenses are not migration targets.

### Project configuration

`upcomputer.json` is preferred. The loader falls back to `t3.json` **only** on
NotFound, never because the preferred file is invalid/unreadable. The scripts
menus in Classic and Focus use direct file reads with the same precedence; they
do not merge both sets of commands or infer absence from a filtered search index.
The RPC adds an optional `notFound` bit. Automatic legacy discovery requires this
bridge server: older message-only errors fail closed instead of treating an
unknown read failure as proof of absence.

`upcomputer project migrate-config <workspace>` performs a read-only inspection;
`--confirm` publishes the preferred file. It is a Git working-tree change, so it
is not performed during ordinary project discovery. Publication uses an fsynced
staging file and an exclusive hard link (no overwrite, no partially written
preferred file). JSONC/comments and original bytes are preserved. The original
`t3.json` is the rollback copy and is not deleted. Symlinked configuration requires manual migration rather than copying its
target into the repository. Different existing files are a
conflict; a repeated identical migration is a no-op. Hard-link-unsupported
filesystems fail without changing either configuration. Do not edit the source
while migrating; concurrent late edits remain in the original for reconciliation.
The schema endpoint is built at `/schema/upcomputer.json`; deployment is a
separate release step. Historical `$schema` strings in user files are not blindly
rewritten inside arbitrary JSONC/comments.

### Browser stores and pending OAuth state

`legacyIndexedDb.ts` transitions connection catalogs and DPoP keys to UpComputer
names. It requires a secure context with Web Locks. The old database is retained
as a recovery source; a version-change barrier requires old handles to close and
prevents pinned old clients from writing after retirement. Blocked upgrades fail
with a close-other-tabs instruction, not an empty profile. A cancelled queued
upgrade must abort when eventually unblocked.

The destination records and completion marker commit in one transaction.
Interrupted/quota-failed copies can retry from retained data. Existing independent
destination state is a conflict, not something to overwrite or merge. The marker
prevents a later logout/deletion from resurrecting old records. Server-derived
caches are rebuilt, not copied. Non-extractable CryptoKeys use IndexedDB's native
structured clone; no key export, stringification or logging is involved.

This is a **one-way** browser schema transition. Merely reinstalling an old binary
is not a rollback: old clients pinned to the prior IndexedDB version are rejected.
Restore a pre-upgrade profile backup to roll back. No automatic source-database
cleanup or production-profile conversion was executed during development.

Pending Connect OAuth request state (not saved access credentials) moves to its
new sessionStorage key without consuming it across repeated React renders. A
failed write leaves the legacy state check available.

### HTTP/auth compatibility

New clients request `/.well-known/upcomputer/environment`; an explicit 404 alone
permits retrying the legacy descriptor endpoint. Authentication errors, malformed
responses and timeouts do not trigger a naming downgrade. New servers serve both
endpoints. The descriptor advertises the UpComputer bootstrap token type; older
servers without this capability use the legacy type, and new servers accept both.
Callers without a descriptor still use the compatibility default during this
bridge. Some desktop/Tailscale health probes still use the legacy endpoint.

Browser sessions use `upcomputer_session` with the existing port-isolation rules.
A valid legacy browser cookie is exchanged in the session-state response for the
same server-side session under the new cookie name, with HttpOnly/path/SameSite
and expiry preserved; the old cookie is expired. A present invalid new cookie is
not bypassed by a valid old cookie. Session scopes, revocation and DPoP checks are
unchanged.

### Environment continuation

Direct dev/Vite/relay/lifecycle reads and Bitbucket configuration now prefer the
new names through the shared legacy adapter. Project-script runtime environment
emits new names plus temporary legacy aliases; overrides normalize before merge.
External shell/CI configuration is not rewritten. This is not yet a claim that
all launchers, deployment configuration and platform-specific emitters have
been converted.

### Local data copy, not an automatic migration system

The generic native migration coordinator, ownership database, startup fences,
Git/Pi migration participants and encryption-name bridge have been removed.
No background/native profile relocation is installed. Preserve the original
profile and arrange a stopped-app copy separately; retain `state.sqlite` and its
associated attachments/sessions, and review stored absolute paths in the copy.
Remote connection catalogs are not required for the current local-only transfer.
Provider sign-in is a separate check, not evidence that chat data was lost.

New native defaults are `~/.upcomputer` for backend data and `UpComputer` (or
`UpComputer Dev`) under the platform application-support directory for Electron.
Neither root discovers old T3 folders. `T3CODE_HOME` is no longer an accepted
fallback: use `UPCOMPUTER_HOME` or an explicit CLI base directory. An explicit
operator-selected directory is still honored. New encryption uses the package's
UpComputer identity; no legacy-name override is installed. The existing old app
and old profiles must remain untouched until the local copy is agreed.

## Verification record: one-way bridge implementation

- Focused project/schema/config/storage/auth/HTTP tests passed, including a real
  RPC missing-file flag and valid-legacy/invalid-new cookie precedence.
- Ten integrated browser assertions/tests pass on the rebuilt isolated stack:
  migration/retry/conflict/old-writer retirement, non-extractable synthetic-key
  preservation, concurrent opens, no logout resurrection, project-config
  precedence/fallback/visible invalid-config warning in Focus, legacy UI draft
  retention, and workspace chrome. No script or model prompt was executed.
- The composed CLI was exercised against a disposable JSONC project: no write
  without consent, byte-preserving publication, original retained, repeatable.
- Public server/web/desktop and private agent/task-server typechecks, private
  focused integration tests, composed server build, desktop code build and
  marketing schema build passed. These are not native installed-app upgrade tests.
- No installed Alpha, real profile, real provider credentials or deployed cloud
  resources were migrated. The human-test dev environment was not restarted.
