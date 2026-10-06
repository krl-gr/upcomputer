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

## Web hooks

The web composition carries the flags too. Upstream files call `apps/web/src/product/productFlags.ts`, which reads them lazily because upstream state modules import it:

- The resolved keybindings (`state/server.ts`, the Keybindings settings page) drop terminal, project script, pull request and settle commands, so their shortcuts, labels and rows go with them.
- Settings search filters the hidden rows; the rows themselves are gated where they render (terminal font and its preview, device settings, PR merge method, GitHub routing).
- The right-panel launchers drop the Terminal, Pull request, Linked pull requests and Device entries.
- Chat view: no terminal toggle, project scripts, "Run in terminal" or setup-terminal button, and no device state subscription.
- No PR badges or PR summary reads (`useLinkedThreadPullRequest`), no `#` pull request menu in the composer, and `/pull-requests` redirects home.
- The sidebar has no Settled section and no bulk Settle.
- No terminal metadata subscription per thread row.

Web unit tests alias `product/productEntry` to `apps/web/test/coreProductEntry.ts`, so upstream's tests run with upstream's flags. Tests for a hidden feature mock the entry, as `product/productFlags.test.tsx` does.

## Surfaces

Some upstream UI is replaced rather than hidden. `ProductSurfaces` in the same module names each replaceable surface, and its value is `upstream` (exactly upstream's UI) or `upcomputer` (the product's version). `UPSTREAM_PRODUCT_SURFACES` is core's default; the public build passes `UPCOMPUTER_PRODUCT_SURFACES` to the web composition. The product's version lives in its own files, and upstream's file gets a minimal hook through `productSurface` in `apps/web/src/product/productFlags.ts`:

- `sidebarProjects`: the sidebar's Projects and Threads sections (`apps/web/src/sidebarProjects/`) under the navigation entries, and a search row with search only, at the rows' regular weight (`components/sidebar/SidebarThreadHeader.tsx`): Add project and New thread move into the section headers. The Projects section reads and writes upstream's persisted project scope, so the thread list filters exactly as upstream's scope menu does. The Threads header only collapses upstream's thread list (`useSidebarThreadListShown` in `Sidebar.tsx`); the list itself is upstream's. New thread, both the Threads pencil and `chat.new` (gated in `routes/_chat.tsx`), starts a thread without a project through upstream's scratch project, as V1 did; Shift+click on the pencil runs upstream's click (the project picker), and the command palette labels its "New thread in <project>" item with `chat.newLocal` instead.
- `sidebarThreadRow`: the sidebar's thread rows. Here the product's version is also a user choice: Settings, Appearance, "Thread list" (the `sidebarThreadList` client setting, stored like Chat width) picks the compact one-line row (`apps/web/src/sidebarThreadRow/`, the default) or upstream's detailed row, and the sidebar switches at once. `Sidebar.tsx` swaps the row component it renders, so both rows get the same props from upstream's list, shelves and actions. Both rows show a thread's status as V1's text label (`ThreadStatusLabel`): upstream's status derivation decides the kind, and in upstream's detailed row the label replaces only its status indicator. With `upstream` the setting row and its settings search entry are hidden and the rows are upstream's.
- `sidebarHeader`: the sidebar's titlebar row (`components/sidebar/SidebarChrome.tsx`) shows no brand and no stage badge, and `AppSidebarLayout.tsx` moves the sidebar toggle so its icon starts where the row icons do (`SIDEBAR_TOGGLE_ALIGNMENT` in `apps/web/src/sidebarMetrics/`). The macOS desktop app keeps the toggle after the traffic lights. The stage label stays everywhere else, and the header keeps its titlebar height and drag region.
- `composerFooter`: the composer's footer row in V1's layout (`apps/web/src/composerFooter/`), built from upstream's own controls: attach, Build or Plan, provider and model in one label, effort and context in upstream's traits picker, access as a lock with upstream's access menu, then the context ring and send. Trailing controls fold into upstream's `CompactComposerControlsMenu` as V1's footer did. `ChatComposer.tsx` hands the row upstream's attach action, model picker and primary actions as elements (`composerAttachAction`, `composerModelPicker`, `composerPrimaryActions`), renders the picker through `ComposerFooterModelPicker` for the combined label, and takes the idle placeholder from `composerIdlePlaceholder`. The resting row a timeline scroll collapses the composer into stays upstream's, as do the stash badge, queued runs and usage limits above the composer.
- `composerContextRow`: V1's row under the composer card (`apps/web/src/composerContextRow/`) replaces upstream's context strip: the chat's project, its linked projects (click one to unlink) and `+` to link another, then upstream's checkout mode and branch selectors shown as text, then the right-panel toggle. In an unsent chat without a project `+` moves the draft into the chosen project; an unsent chat in a project shows no `+`, since links need a thread. `ChatView.tsx` turns off upstream's strip (`hasActiveProject`), renders the row under `ComposerSurface.Shell` with the same props it gives `BranchToolbar` (and `branchToolbarRef`, so the branch and previous-worktree shortcuts reach it), and drops the header's right-panel toggle. `ChatComposer.tsx` looks for control shortcut triggers in the whole composer stack (`composerShortcutScope`), and the row hides the branch selector's pull request badge (`showPullRequestBadge`). The resting composer's controls fall back to upstream's model strip. The chat header then shows only the thread title and its accessories: `ChatHeader.tsx` drops the project breadcrumb, and the linked-projects header accessory renders nothing.

## Mobile app

The mobile app is not a flag: `pnpm-workspace.yaml` excludes `apps/mobile` from install and build, and `allowUnusedPatches` keeps its patch entries valid. Upstream's mobile CI workflows filter on `@t3tools/mobile` and would fail; this fork does not run them.

## Sync rule

Every hook goes through `productFlags`, `whenProductFeature` or `isProductFeatureShown`. After an upstream sync, `git grep -n -e productFlags -e whenProductFeature -e isProductFeatureShown -e productSurface` lists the hooks to re-check. When upstream adds a new entry point to a hidden feature, gate it the same way.
