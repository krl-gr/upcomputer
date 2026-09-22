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
