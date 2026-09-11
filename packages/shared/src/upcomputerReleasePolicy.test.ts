import { describe, expect, it } from "vite-plus/test";

import {
  canOfferRemoteServerSelfUpdate,
  UPCOMPUTER_RELEASE_CAPABILITIES,
} from "./upcomputerReleasePolicy.ts";

describe("Up.computer release policy", () => {
  it("supports the bundled local Desktop and T3 Connect without an npm server", () => {
    expect(UPCOMPUTER_RELEASE_CAPABILITIES).toMatchObject({
      bundledDesktopBackend: true,
      localProviders: true,
      t3ConnectToBundledDesktop: true,
      npmRemoteServerDistribution: false,
      sshRemoteServerBootstrap: false,
      remoteServerSelfUpdate: false,
      backgroundServiceSetup: false,
    });
  });

  it("only offers updates delivered by the remote machine's Desktop app", () => {
    expect(canOfferRemoteServerSelfUpdate("desktop-managed")).toBe(true);
    expect(canOfferRemoteServerSelfUpdate("boot-service")).toBe(false);
    expect(canOfferRemoteServerSelfUpdate("respawn")).toBe(false);
    expect(canOfferRemoteServerSelfUpdate(null)).toBe(false);
  });
});
