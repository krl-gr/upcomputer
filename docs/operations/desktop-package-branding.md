# Desktop package branding

The staged application is `upcomputer`, authored by `Up.computer`. Both public
and official/private builds use `scripts/build-desktop-artifact.ts`; changing a
workspace's package name is not sufficient to change the shipped metadata.

## Generated identity

| Surface                              | Value                                            |
| ------------------------------------ | ------------------------------------------------ |
| Staged `package.json` name           | `upcomputer`                                     |
| Publisher / Windows `CompanyName`    | `Up.computer`                                    |
| Product / executable display name    | `Up.computer (Alpha)` or `Up.computer (Nightly)` |
| Artifact name                        | `Up.computer-${version}-${arch}.${ext}`          |
| Application / Windows AppUserModelID | `computer.up.upcomputer` (unchanged)             |
| electron-updater download cache      | `upcomputer-updater`                             |
| Embedded commit field                | `upcomputerCommitHash`                           |
| Packaged WSL node-pty marker         | `upcomputer-wsl-node-pty.json`                   |

Local-test builds retain their separate application ID and profile. Linux retains
its already-branded `upcomputer` executable. Windows keeps its already-branded
executable filename and shortcut/product name, rather than renaming them again.
The WSL marker writer, preflight reader, and development rebuild use one constant.

## Existing installations and data

NSIS derives the upgrade/uninstall GUID from **appId**, which does not change.
It discovers the existing install location through the same registry identity.
A new package name must not be implemented as a new application ID.

The updater's old `t3code-updater` directory is disposable download state, not user
data. New releases use the new cache; the old cache is left untouched. An older
updater can install the new release, whose updater then uses the new cache.

Database, chats, tasks, settings, and Electron profile paths are resolved explicitly
by `DesktopEnvironment` / `DesktopAppIdentity`, independently of package name.
The standalone defaults are `~/.upcomputer/userdata/state.sqlite` and the
`Up.computer` Electron profile (`Up.computer (Dev)` in development). No old T3 home,
profile, environment variable, or commit-metadata alias is read automatically.
Copying existing data is a separate, stopped-app operation; the source is retained.

Upstream copyright/license notices and attribution are retained. Technical runtime
aliases are not attribution. See `product-name-migration.md` for the current scope.

## Verification

Focused packaging tests exercise the installed electron-builder `AppInfo`, not
just our input literals: publisher, product/executable names, updater cache, and
application ID. Identity tests cover canonical commit metadata, ignored old metadata, and
explicitly resolved profiles. Desktop and packaging-script typechecks also cover both WSL
marker producers and its consumer.

Before release, still run native Windows checks on an isolated machine:

1. Fresh install: EXE/installer file properties, publisher, shortcut, uninstall
   entry, launch and update check.
2. Upgrade from 0.0.31 with seeded chats/tasks/settings: same installation entry,
   same profile and data, no duplicate shortcuts, subsequent update download.
3. WSL preflight loads the newly packaged node-pty marker and binary.

Configuration/unit tests on macOS are not proof of a successful Windows install
or upgrade. Do not use a working user's profile for these tests.
