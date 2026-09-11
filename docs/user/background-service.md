# Background service availability

Up.computer does not provide an official headless or background-service installation in this
release. The supported backend is bundled with and managed by the local Desktop application.

The npm package named `t3` belongs to upstream T3 Code. Its service commands do not install or
repair an official Up.computer backend and must not be used as an Up.computer update path.

Existing service installations are not migrated or deleted by this policy. Their data remains on
the machine, but they are not officially supported by this release. A future server/CLI
distribution decision will define a supported installation and migration path.
