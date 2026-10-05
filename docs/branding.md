# Up.computer branding

Up.computer is upstream T3 Code with a thin brand on top. Only what users see, plus the identifiers
that cannot change after release, says Up.computer. Everything internal stays upstream's, so merges
from upstream stay cheap and upstream clients (such as the Swift iOS client) stay compatible.

**Stays upstream:** the `@t3tools/*` package scope, `T3CODE_*` variable names, type, file and
function names, the `t3` CLI name, and the pairing and Connect protocol (`/.well-known/t3/environment`,
`urn:t3:...`, JWT `typ` values, the `t3-code` MCP server and its `serverInfo`, the Codex
`clientInfo`, relay stack and resource names).

## After every upstream merge

```sh
node scripts/apply-branding.ts   # rewrites T3 copy that came back in
node scripts/check-branding.ts   # fails on any other regression; fix those by hand
```

Resolve merge conflicts in rebranded lines by taking upstream's side, then run the codemod. CI runs
the check (`.github/workflows/branding.yml`), and so does the release preflight.

## Identity that must match V1

Installed V1 apps auto-update into this build and keep their macOS permissions, keychain items and
data only while these values stay exactly as V1 shipped them. The single source is
`packages/shared/src/upcomputerIdentity.ts`; `scripts/upcomputer-identity.test.ts` asserts the V1
literals against it and against the electron-builder config.

| Identity                | Value                                                                                              | Set in                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App id, AppUserModelID  | `computer.up.upcomputer` (dev `.dev`)                                                              | `upcomputerIdentity.ts`, `apps/desktop/src/app/DesktopEnvironment.ts`, `scripts/build-desktop-artifact.ts`, `apps/desktop/scripts/electron-launcher.mjs`                                      |
| Product name            | `Up.computer (Alpha)`, nightly `Up.computer (Nightly)`                                             | `apps/desktop/package.json`, `scripts/build-desktop-artifact.ts`, `DesktopEnvironment.ts` (`APP_BASE_NAME`)                                                                                   |
| URL schemes             | `upcomputer`, `upcomputer-dev`                                                                     | `apps/desktop/src/electron/ElectronProtocol.ts`, `apps/server/src/http.ts`, `packages/shared/src/codexAuthHandoff.ts`, `packages/shared/src/providerAuthReturnUrl.ts`, build config, launcher |
| Home directory          | `~/.upcomputer`, worktrees `.upcomputer`                                                           | `apps/desktop/src/app/DesktopStatePaths.ts`, `apps/server/src/os-jank.ts`, `packages/shared/src/devHome.ts`, `scripts/dev-runner.ts`, `.gitignore`                                            |
| Electron profile folder | `Up.computer`, dev `Up.computer (Dev)`                                                             | `apps/desktop/src/app/DesktopUserData.ts`                                                                                                                                                     |
| Local test build        | `computer.up.upcomputer.localtest`, `UpComputer Local Test`, `~/.upcomputer-local-test`            | `apps/desktop/src/app/UpcomputerStartupEnvironment.ts`, `DesktopEnvironment.ts`, `DesktopUserData.ts`, build config                                                                           |
| Linux names             | executable and WM class `upcomputer`, entry `computer.up.upcomputer.desktop`                       | `apps/desktop/src/app/DesktopEarlyElectronStartup.ts`, build config                                                                                                                           |
| Package name            | `upcomputer` (NSIS name, updater cache)                                                            | `scripts/build-desktop-artifact.ts`                                                                                                                                                           |
| Update feed             | GitHub releases of `krl-gr/upcomputer`, stable tags `core-vX.Y.Z`, channels `latest` and `nightly` | `.github/workflows/release.yml`, `scripts/build-desktop-artifact.ts` (`GITHUB_REPOSITORY`), `scripts/resolve-previous-release-tag.ts`                                                         |
| Signing                 | V1's Apple and Azure Trusted Signing secrets; passkey profile optional                             | `.github/workflows/release.yml`, `scripts/build-desktop-artifact.ts`                                                                                                                          |
| Telemetry               | V1's Up.computer PostHog project key                                                               | `apps/server/src/telemetry/AnalyticsService.ts` (the check pins its hash)                                                                                                                     |
| Hosted app URL          | `https://up.computer`                                                                              | `packages/shared/src/connectAuth.ts`                                                                                                                                                          |
| Worktree branch prefix  | `upcomputer/`                                                                                      | `packages/shared/src/git.ts`, `packages/contracts/src/settings.ts`                                                                                                                            |
| Release links           | `krl-gr/upcomputer` releases, `core-v` tags                                                        | `apps/web/src/components/desktopUpdate.logic.ts`                                                                                                                                              |
| CLI archives            | `krl-gr/upcomputer` (not published yet, fails closed)                                              | `packages/shared/src/cliRelease.ts`                                                                                                                                                           |

## User-visible copy and artwork

- **Copy:** `scripts/apply-branding.ts` rewrites "T3 Code" to "Up.computer", "T3 Connect" to
  "UpComputer Connect", and a few "T3 thread/server/home" phrases in the web app, desktop shell,
  server, shared packages and the relay's push text. Rules, scope and the protocol lines it keeps
  are in `scripts/lib/branding.ts`. Comments are left as upstream wrote them.
- **Names in code:** `APP_BASE_NAME` in `apps/web/src/branding.ts` and
  `apps/desktop/src/app/DesktopEnvironment.ts` (window titles, about panel, menus), the sidebar and
  welcome wizard (`SidebarChrome.tsx`, `WelcomeWizard.tsx`), `apps/web/index.html`,
  `apps/web/public/manifest.webmanifest`.
- **Artwork from V1:** `assets/prod/upcomputer-*` and `assets/dev/upcomputer-blueprint-*` (nightly
  uses the blueprint too), wired in `scripts/lib/brand-assets.ts`, `DesktopAssets.ts` and the dev
  launcher; `apps/web/public` favicons; the app icon replaces the T3 wordmark in `T3Wordmark.tsx`;
  the DMG backgrounds in `apps/desktop/resources/dmg`. Upstream's files stay in the tree untouched.

## Environment variables

Entry points copy every `UPCOMPUTER_<NAME>` variable to `T3CODE_<NAME>`, and the `UPCOMPUTER_` value
wins when both are set (`packages/shared/src/upcomputerEnv.ts`). They run in `apps/server/src/bin.ts`
and `runCli` in `binCli.ts` (so product entries get them too), the desktop main process
(`UpcomputerStartupEnvironment.ts`, which the backend inherits), `scripts/dev-runner.ts`, `scripts/build-desktop-artifact.ts`, and the
repository `.env` loader (`scripts/lib/public-config.ts`) used by builds. Common ones:

| Set                                          | Same as                              |
| -------------------------------------------- | ------------------------------------ |
| `UPCOMPUTER_HOME`                            | `T3CODE_HOME`                        |
| `UPCOMPUTER_PORT`                            | `T3CODE_PORT`                        |
| `UPCOMPUTER_TELEMETRY_ENABLED`               | `T3CODE_TELEMETRY_ENABLED`           |
| `UPCOMPUTER_DISABLE_AUTO_UPDATE`             | `T3CODE_DISABLE_AUTO_UPDATE`         |
| `UPCOMPUTER_DESKTOP_UPDATE_REPOSITORY`       | `T3CODE_DESKTOP_UPDATE_REPOSITORY`   |
| `UPCOMPUTER_RELAY_URL`, `UPCOMPUTER_CLERK_*` | `T3CODE_RELAY_URL`, `T3CODE_CLERK_*` |
| `UPCOMPUTER_DEV_AUTH_TOKEN`                  | `T3CODE_DEV_AUTH_TOKEN`              |

## Release and Connect

- `.github/workflows/release.yml` is V1's standalone core release on the v2 tree; upstream's
  `release-desktop.yml` is unused. `deploy-relay.yml` runs only once `RELAY_DOMAIN` or
  `RELAY_API_ZONE_NAME` is set.
- UpComputer Connect runs upstream's relay as is. See
  [UpComputer Connect setup](./operations/upcomputer-connect-setup.md).
