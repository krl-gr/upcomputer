# Browser and computer use

Browser automation and native computer use ship in the public build and work
for every agent harness (Claude, Codex, OpenCode, Cursor, Grok, and others).
Both reach agents through the `upcomputer` MCP server at `/mcp` that every
provider session receives with its own credential.

The packages:

- `@upcomputer/computer-use-contracts`: settings schemas and the
  `upcomputer.computer-use.v1` RPC group used by the settings pages.
- `@upcomputer/computer-use-server`: the managed Chrome host, the computer-use
  service with its sidecar, the shared policy, and the `computer_*` MCP tools.
- `@upcomputer/computer-use-web`: the Browser Use and Computer Use settings
  pages.

The public product entries (`apps/server/src/product/publicProductEntry.ts`
and `apps/web/src/product/defaultProductEntry.ts`) compose them through the
extension API.

## Browser

The `preview_*` tools drive the desktop app's built-in browser while the app is
open. Otherwise, or when **Settings → Browser Use → Always use Chrome** is on,
the same tools run in an installed Chrome or Edge through `playwright-core`,
with a dedicated persistent profile in `<state dir>/browser-profiles/default`.
Use Chrome for sites that reject embedded browsers, such as Google sign-in or
passkeys. The setting is stored as `browser.alwaysUseChrome` in the server
settings file.

## Computer use

The `computer_*` tools observe (`computer_list_apps`,
`computer_get_app_state`, `computer_screenshot`) and control (click, type,
keys, set value, scroll, drag, secondary actions) desktop apps through the
[`open-computer-use`](https://github.com/iFurySt/open-codex-computer-use)
MCP sidecar, pinned at 0.3.5 and started on first use.

### Enabling

Computer use is on by default. **Settings → Computer Use** has the switch to
turn it off and its options, stored in the `computerUse` section of the server
settings file:

- **Mode**: Observe allows only the observation tools; Control also allows
  actions.
- **Action approvals** (off by default): ask before every control action, even
  in full-access threads.
- **Allowed applications**: when set, only these apps may be targeted.
- **Coordinate fallback** (off by default): allow raw x/y targets.

### Policy per session

Features add tools to that server with the `mcpTools` contribution
(`apps/server/src/product/McpToolContribution.ts`). For each call, core reads
the calling thread's current interaction mode and runtime mode, so a mode
change applies to the next call. The computer-use tools apply:

- A read-only mode, such as Plan or Ask, may only observe. Actions need a mode
  whose mutations are allowed, such as Default.
- Apps that look like credential or payment surfaces (password managers,
  Keychain, wallets, payment screens) are always blocked.
- A thread whose mode cannot be resolved is refused.
- Where the bundled UpComputer agent would ask the user for approval, other
  agents are refused instead, since they cannot ask yet: every call in a
  Supervised (approval-required) thread, and control actions while Action
  approvals is on.

The bundled UpComputer agent uses the same service and policy and keeps its
own approval prompts.

### macOS permissions

The sidecar needs **Accessibility** and **Screen Recording**. macOS grants
them to the app as a whole, so every agent shares them. The Computer Use
settings page checks them and links to the right System Settings pane.

See [verification.md](./verification.md) for the backend contract and how it
was verified.
