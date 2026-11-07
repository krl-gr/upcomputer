/**
 * The `pullRequestAgentTools` product flag: whether this server registers the PR tools. Runtime
 * instructions name those tools only while it is on. The server CLI sets it from its product
 * (`apps/server/src/binCli.ts`); it stays on otherwise, as upstream.
 */
let registered = true;

export function pullRequestAgentToolsRegistered(): boolean {
  return registered;
}

/** Set by the server CLI from its product flags; tests set it directly. */
export function setPullRequestAgentToolsRegistered(value: boolean): void {
  registered = value;
}
