import {
  EnvironmentId,
  type EnvironmentCloudLinkStateResult,
  LINK_KEY_STALE_NOTICE_ID,
  type ServerConfig,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  snapshot: null as EnvironmentCloudLinkStateResult | null,
}));

vi.mock(import("../connection/runtime"), () => ({
  connectionAtomRuntime: { atom: Atom.make } as never,
}));
vi.mock(import("../state/environments"), () => ({
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("../state/session"), () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock(import("../state/server"), () => ({
  serverEnvironment: {
    configValueAtom: Atom.family((_environmentId: EnvironmentId | null) =>
      Atom.make<ServerConfig | null>(null),
    ),
  } as never,
}));
vi.mock(import("./linkEnvironment"), () => ({
  readCloudLinkState: (() => Effect.sync(() => testState.snapshot)) as never,
}));

import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import { readCachedCloudLinkState } from "./cloudLinkState";

const environmentId = EnvironmentId.make("primary");
const linked: EnvironmentCloudLinkStateResult = {
  linked: true,
  linkKeyStale: false,
  cloudUserId: "user_a",
  relayUrl: "https://relay.example.com",
  relayIssuer: "https://relay.example.com",
  managedTunnelActive: true,
  publishAgentActivity: false,
};

describe("cloud link state", () => {
  it("reads link state again when the server reports a stale key after the first read", async () => {
    testState.snapshot = linked;
    const target = { environmentId };
    readCachedCloudLinkState(target);
    await vi.waitFor(() => expect(readCachedCloudLinkState(target)?.linkKeyStale).toBe(false));

    // The server finds the stale key later; the cached read alone would keep the old answer.
    testState.snapshot = { ...linked, linkKeyStale: true };
    expect(readCachedCloudLinkState(target)?.linkKeyStale).toBe(false);

    const config = serverEnvironment.configValueAtom(
      environmentId,
    ) as Atom.Writable<ServerConfig | null>;
    appAtomRegistry.set(config, {
      backgroundNotices: [
        {
          id: LINK_KEY_STALE_NOTICE_ID,
          area: "remote-access",
          severity: "warning",
          title: "Other devices can't reach this computer",
          message: "This computer needs to reconnect to UpComputer Connect.",
          occurredAt: "2026-11-09T00:00:00.000Z",
        },
      ],
    } as unknown as ServerConfig);
    await vi.waitFor(() => expect(readCachedCloudLinkState(target)?.linkKeyStale).toBe(true));
  });
});
