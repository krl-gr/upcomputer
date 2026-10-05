# Product flags

UpComputer ships on upstream core but does not ship every upstream feature. It hides them instead of deleting them, so an upstream sync only has to keep a few hook lines instead of re-deleting rewritten files.

`packages/shared/src/productFlags.ts` is the one place that says what a product shows:

- `ProductFlags` lists the hideable features: `pullRequests`, `terminal`, `threadSettlement`, `devices`.
- `UPSTREAM_PRODUCT_FLAGS` shows everything. Core without a product composition uses it, so stock core and upstream's own tests behave as upstream.
- `UPCOMPUTER_PRODUCT_FLAGS` hides all four. The public build (`apps/server/src/product/publicProduct.ts`, `apps/web/src/product/productEntry.ts`) and pro pass it to `composeExperimentalServerFeatures` / `composeExperimentalWebFeatures`.
- A table in the same module maps each flag to the capabilities, keybinding commands, settings search items and right-panel launchers it hides.

## Server hooks

The composition carries the flags; upstream files read them through `ServerProduct`:

- `environment/ServerEnvironment.ts`: the descriptor drops the pull request and settlement capabilities. Every client, web and mobile, already hides that UI when a capability is missing.
- `server.ts`: the settlement worker and the pull request workers (branch PR sync, linked PR sync, PR watch) do not start. `whenProductFeature` drops a layer; `isProductFeatureShown` guards a start effect whose service other layers still need.
- `mcp/McpHttpServer.ts`: agents do not get the pull request and device tools.

The terminal and device services stay: worktree setup scripts run in a server terminal, and the device service idles unless device support is turned on in settings, which the product hides.

## Sync rule

Every hook goes through `productFlags`, `whenProductFeature` or `isProductFeatureShown`. After an upstream sync, `git grep -n -e productFlags -e whenProductFeature -e isProductFeatureShown` lists the hooks to re-check. When upstream adds a new entry point to a hidden feature, gate it the same way.
