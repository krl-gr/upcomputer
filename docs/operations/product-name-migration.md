# Independent UpComputer runtime names

The local desktop/server/web runtime uses its own names. It does not discover,
import, or continue reading upstream T3 state. Upstream licenses, authorship,
reference URLs, and historical evidence remain intact.

## Current names

| Surface                                | Name                                                           |
| -------------------------------------- | -------------------------------------------------------------- |
| Backend home                           | `~/.upcomputer` (or explicit `UPCOMPUTER_HOME` / `--base-dir`) |
| Production database                    | `~/.upcomputer/userdata/state.sqlite`                          |
| Electron profile                       | `UpComputer`; development `UpComputer Dev`                     |
| Workspace packages                     | `@upcomputer/*`                                                |
| CLI/package                            | `upcomputer` / `@upcomputer/server`; no `t3` launch alias      |
| Configuration environment              | `UPCOMPUTER_*`; no `T3CODE_*` lookup or emission               |
| Project config                         | `upcomputer.json`; old `t3.json` is ignored                    |
| Browser preferences                    | `upcomputer:*`; no old-key reads/imports                       |
| Browser databases                      | `upcomputer:connection-runtime` v5, `upcomputer:cloud-auth` v2 |
| Session cookie                         | `upcomputer_session`; old cookie ignored, not rewritten        |
| Environment descriptor                 | `/.well-known/upcomputer/environment`                          |
| Bootstrap token type                   | `urn:upcomputer:params:oauth:token-type:environment-bootstrap` |
| Embedded commit                        | `upcomputerCommitHash`; old metadata ignored                   |
| Generated Git branches/checkpoint refs | `upcomputer/…` / `refs/upcomputer/…`                           |
| Service/MCP/relay client names         | UpComputer names in both producers and consumers               |

Normal schema evolution inside UpComputer databases remains. There is no native
migration coordinator, ownership database, browser cross-brand migration, project
config migration command, or legacy encryption-name override.

## Existing local data

This source change does not copy any real data, stop the installed Alpha, replace
an application, or publish a release. First build the final local application.
Then agree on stopping the working application/agents and copy the required data
once, retaining the source. Keep the filename `state.sqlite`; do not replace the
entire `.upcomputer` directory because it can already contain dev data/worktrees.

Inspect and adjust necessary structured paths/settings in the copy, not arbitrary
conversation text. Existing Git branches/checkpoint refs are not renamed by these
source edits; inspect needed references during that one-time copy. Provider login
survival is not verified and may require signing in again. No remote encrypted
connection catalog is needed for the current local-only profile.

## Deliberately separate surfaces

- Native mobile application IDs, URL schemes, native module names and Expo owner
  remain a separate platform cutover, not part of this Mac profile move. Shared
  environment and wire-protocol names match the current server.
- Hosted services are not provisioned or deployed here. Optional Connect/relay
  builds require explicit deployment configuration. Web publication/proxy config
  no longer silently targets upstream domains. Remote npm/service installation
  remains disabled by the existing UpComputer release policy.
- Third-party package names, upstream issue URLs, licenses, and historical docs
  are not runtime compatibility and must not be erased.

The public and private repositories must be pinned together. Focused checks cover
canonical names and rejection/ignoring of old input. Browser verification uses a
separate synthetic profile, never the installed application's profile.
