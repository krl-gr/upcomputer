# Server updates in this release

The supported Up.computer backend is bundled with the local Desktop application. Update it by
installing an Up.computer Desktop update; the app restarts its bundled backend as needed.

Official remote/headless server installation and updates are not available in this release. If a
saved remote environment reports a version mismatch, Up.computer keeps the record and its data
intact but does not offer an npm update, automatic server update, or copied CLI command. You can
still inspect, disconnect, or remove the saved environment from **Settings** → **Connections**.

The npm package named `t3` is upstream T3 Code, not an Up.computer server distribution. Do not use
it to resolve an Up.computer version mismatch. Support can be re-enabled only after an official
server/CLI identity and delivery mechanism are selected.
