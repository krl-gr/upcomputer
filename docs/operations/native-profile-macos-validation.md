# macOS native profile validation — 2026-09-23

## Scope and evidence

Disposable Tart VM `upcomputer-profile-native-validation`, macOS 26.6.2 (25G83),
Apple Silicon, Electron 41.5.0, 2 CPUs / 4096 MiB. The installed app was the signed
0.0.31 artifact from `macos-arm64-signed-ci-35356857495`; guest
`codesign --verify --deep --strict` passed. This is not a new Gatekeeper assessment
(the vendor baseline has its own security defaults).

The OS key and catalog were created **inside the guest**, using synthetic data
without credentials. No host profile, keychain, key or provider login was copied.
The real `DesktopConnectionCatalogStore` and `ElectronSafeStorage` implementations
were used, not identity encryption or fake crypto.

Results:

- Signed 0.0.31 creates and decrypts an encrypted catalog; a separate app process
  reopens it successfully.
- **Reproduced incompatibility:** changing the early Electron app name from
  `t3code` to `upcomputer` makes that catalog fail with the store's
  `decrypt-catalog` protection error. Encryption remains available. Changing the
  visible name later to `Up.computer (Alpha)` does not rescue it.
- The new `configureLegacyEncryptionIdentity` helper, executed before readiness,
  preserves decryption while retaining the later visible product name.
- The coordinator makes verified backup/candidate copies. Native decryption runs
  during both candidate and published validation. Source bytes remain unchanged;
  validation does not mutate the candidate tree.
- After stopping and starting the entire VM, the relocated catalog still decrypts.
- A synthetically corrupted ciphertext is rejected without overwriting/deleting it.
- A second catalog generation is written successfully. Automatic rollback after
  activation is refused. The old backup is readable in a separate restore fixture,
  while newer state remains readable in both the destination and its preservation
  copy. No active profile was replaced by this restoration experiment.

The early-name comparison runs in the **same signed executable** through a local
main-process debugger pause before the first app statement. This isolates name
selection from changes in signing identity. It is not an installed upgrade to a
new signed candidate. A generic Electron was also tried: macOS requested access
to the fixture key; that request was denied, not granted or bypassed. No password
was requested through chat, typed by the agent or read from the guest.

## Temporary encryption bridge

`apps/desktop/src/app/legacyEncryptionIdentity.ts` is called synchronously by
`main.ts`, after startup fences and before Clerk construction / Electron readiness.

- Packaged builds retain the encryption boot name `t3code`, including fresh
  installs during this bridge period.
- Source desktop development maps `@upcomputer/desktop` back to its historical
  encryption boot name `@t3tools/desktop`; this mapping has unit coverage, not a
  native source-development upgrade test.
- Independent Electron fixtures are not renamed.
- Late configuration is an error, not a pretend fix.
- Package branding remains `upcomputer`; visible branding is still set later by
  `DesktopAppIdentity`. This does not revert the workspace/package renames.

This is an explicit **temporary migration exception**, not a permanent alias.
Removing it requires a verified transition of all OS-encrypted consumers (catalog,
Clerk, Chromium state and any other discovered consumers), retention of the old
context for recovery, and signed-platform upgrade evidence. Do not delete old OS
keys or silently reset unreadable catalogs. Automatic migration remains disabled.
Experimental builds that already wrote data under the new encryption name are a
separate discovery/conflict case: this bridge does not try both contexts or merge
them. Such profiles need explicit review before a live upgrade.

## Reusable Tart setup (do not rediscover)

A stopped `upcomputer-native-rpc-clean-baseline` checkpoint was saved after RPC
bootstrap, **before** installing Alpha or generating native test keys. Clone it
with `TART_NO_AUTO_PRUNE=1`; keep it stopped and unchanged. The original
`upcomputer-clean-tahoe-baseline` has no Guest Agent.

The previously validated bootstrap remains at
`release-candidates/0.0.31/tart-clean-install/bootstrap/Setup.command` with Guest
Agent 0.10.0. It installs a user LaunchAgent `com.upcomputer.vm-test-rpc` using
`--run-rpc` only, without root or clipboard sharing. Reuse the existing binary;
do not download it or attempt password-based SSH unnecessarily.

- Run Tart in a separate Terminal using a visible `run-vm.command` and log.
- Use `--no-clipboard --no-audio` and only a dedicated technical share: never HOME,
  working profiles, an entire checkout or old evidence containing login captures.
- `--net-host` required privileged Softnet on this host. The validation used
  ordinary NAT; it was **not** an air-gapped/network-isolated VM.
- Do not click the AX window element (index 0): the descendant-action path can
  close the VM. Guest controls require explicitly enabled `sky_click` coordinates.
- Bulk `type_text` does not see guest editables. In this run, shortcut modifiers
  and double-clicks were unreliable too. Finder menu → type `o` to select Open →
  Return worked to open the bootstrap. Switch to `tart exec` immediately afterward.
- Copy Electron frameworks in an archive, then extract **on the guest disk**.
  Direct `ditto` through VirtioFS hit framework symlink errors.
- Do not enter passwords programmatically. Any required system authentication is
  handled by the person directly in the guest.

## Fixture entry points

- `scripts/profile-catalog.native.fixture.mjs`: bundle as CommonJS with Electron
  external. Exposes only synthetic catalog probes and the production compatibility
  helper. Reads validate bytes unchanged; writes are restricted to the fixture.
- `scripts/profile-catalog.native-driver.mjs`: run with a separate Electron runtime
  in Node mode **inside the guest**. It launches the signed app, validates the
  loopback debugger target/PID and stops its owned app after each phase. For
  pre-ready changes, use `Debugger.evaluateOnCallFrame`, not awaited
  `Runtime.evaluate` while paused.
- `scripts/profile-catalog.native-coordinator.mjs`: bundle as ESM; exercises the
  coordinator with native validation callbacks and a closed-world test lease.
  Its released-app validation worker does not participate in the new gate. All
  synthetic writers are controlled; ordinary app state is outside the test roots.
  **This is not a production old-owner exclusion or restore adapter.**

All require `UPCOMPUTER_NATIVE_FIXTURE=tart-profile-v1`, `hw.model=VirtualMac…`,
and a guest-only `~/UpComputer-Native-Profile-Fixture/.fixture` marker containing
`synthetic-only\n`. Never create these opt-in markers on a working OS account.

Typical driver phases, in order:

1. `source` then `source-restart` (default identity).
2. `renamed-identity` (expected native decrypt rejection).
3. `source-restart bridged` (production helper repairs early-name selection).
4. Coordinator `migrate` (native validation before/after publication).
5. Cold guest restart, then `candidate-restart bridged`.
6. `corrupt bridged` against a separately created invalid-ciphertext fixture.
7. `newer bridged`, then coordinator `preserve-and-restore-fixture`.

Only sanitized `result-*.json` status records should leave the guest. Do not export
keychains, private keys, application credentials or catalog plaintext. The test
fixtures and diagnostic debugger must never become a production migration path.

## Still not proven

Full native ownership (old launchers, alternate control homes, detached processes,
external Git writers), signed-candidate installation/update, Windows/Linux crypto,
Chromium cookie/IndexedDB/DPoP relocation, Clerk recovery, all provider/database
references and complete post-activation Git/profile restore remain separate gates.
A readable connection catalog does not establish those guarantees.
