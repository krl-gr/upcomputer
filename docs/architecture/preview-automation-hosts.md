# Preview Automation Hosts

Agents drive a browser through the `preview_*` tools on the `upcomputer` MCP server
(`apps/server/src/mcp/toolkits/preview`). Each call goes through
`PreviewAutomationBroker`, which sends it to a **host** that owns real browser tabs.

## Host kinds

- **Desktop host.** The Electron app registers one host per connected environment from
  `apps/web/src/components/preview/PreviewAutomationHosts.tsx`. Requests stream to it over
  WebSocket and it drives the built-in browser tab.
- **Server host.** A product can register a host that runs inside the server process, for
  example a managed external browser. The public build registers one: the managed Chrome from
  `@upcomputer/computer-use-server` (see [Browser and computer use](../computer-use/README.md)).

Both kinds receive the same `PreviewAutomationRequest` and answer with the same result and
`PreviewAutomationRemoteError` shapes. The broker classifies failures into the same typed errors,
so an agent sees one tool contract whichever host serves it.

## Routing

For each call the broker picks, in order:

1. a server host whose `preferred` effect returns true (a user preference such as "always use
   Chrome");
2. the host this provider session already uses, while it stays connected, so page and cookie state
   do not jump between browsers mid-session;
3. a connected desktop host for the thread's environment;
4. a server host.

Only hosts that support the operation qualify. A server host serves every environment of its
server.

## Registering a server host

Server hosts are trusted build-time contributions on a server feature
(`apps/server/src/product/PreviewAutomationHostContribution.ts`, exported from `extensionApi.ts`):

```ts
defineExperimentalServerFeature({
  id: "example.browser",
  version: 1,
  previewAutomationHosts: [
    {
      id: "chrome",
      ownerId: "example.browser",
      version: 1,
      // Built once per server runtime; may read ServerConfig and add scope finalizers.
      make: Effect.succeed({
        supportedOperations: ["status", "open", "navigate", "snapshot"],
        preferred: Effect.succeed(false),
        execute: (request) => runInBrowser(request),
      }),
    },
  ],
});
```

`execute` receives the session's current tab in `request.tabId` (or the tab the agent named).
A result that carries `tabId` becomes the session's current tab. To reject an operation with a
clear message, list it in `supportedOperations` and fail with
`PreviewAutomationUnsupportedClientError`. If you leave it out, the call can fail with
`PreviewAutomationNoAvailableHostError` instead.
