# Product-name migration

This is a staged migration, not a global replacement of every `T3` token.
Upstream license/copyright notices and historical attribution remain intact.

## Inventory and boundaries

| Area                                                  | Strategy / status                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Desktop package/publisher/update cache                | Already branded `upcomputer` / `Up.computer`; stable appId                                  |
| Public workspace packages, imports, aliases, bundlers | `@upcomputer/*`, mirrored in private optional peers/resolvers                               |
| Lint plugin directory, package, rule IDs              | `oxlint-plugin-upcomputer`, `upcomputer/*`                                                  |
| Server CLI package/bin and help                       | Separate change; old launch commands need compatibility                                     |
| DOM/CSS/internal browser event names                  | Rename producers and consumers together; not persisted                                      |
| Browser UI preferences/drafts/workspace state         | New keys with explicit legacy-key migration; never reset drafts                             |
| Environment variables                                 | New primary names with bounded legacy aliases and precedence tests                          |
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

Native installed-app upgrade and platform checks remain release gates. A browser
or a macOS bundle check is not evidence of a working Windows/mobile migration.
