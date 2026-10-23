import { describe, expect, it } from "vite-plus/test";

import { claimedSidebarThreadKeys, claimSidebarThreads } from "./sidebarThreadClaims";

describe("sidebar thread claims", () => {
  it("hides claimed threads while their section is mounted and returns them after", () => {
    const releaseLocal = claimSidebarThreads("bots:local", ["local:bot-chat"]);
    const releaseRemote = claimSidebarThreads("bots:remote", ["remote:bot-chat"]);
    expect([...claimedSidebarThreadKeys()].toSorted()).toEqual([
      "local:bot-chat",
      "remote:bot-chat",
    ]);

    releaseLocal();
    expect([...claimedSidebarThreadKeys()]).toEqual(["remote:bot-chat"]);
    releaseRemote();
    expect(claimedSidebarThreadKeys().size).toBe(0);
  });

  it("returns a removed bot's chat when the section claims its new list", () => {
    const releaseOld = claimSidebarThreads("bots:local", ["local:kept", "local:removed"]);
    const releaseNew = claimSidebarThreads("bots:local", ["local:kept"]);
    expect([...claimedSidebarThreadKeys()]).toEqual(["local:kept"]);

    // An effect cleanup that runs after the newer claim must not drop it.
    releaseOld();
    expect([...claimedSidebarThreadKeys()]).toEqual(["local:kept"]);
    releaseNew();
    expect(claimedSidebarThreadKeys().size).toBe(0);
  });

  it("keeps the same snapshot when a claim does not change the set", () => {
    const release = claimSidebarThreads("bots:local", ["local:bot-chat"]);
    const before = claimedSidebarThreadKeys();
    const again = claimSidebarThreads("bots:local", ["local:bot-chat"]);
    expect(claimedSidebarThreadKeys()).toBe(before);
    release();
    again();
    expect(claimedSidebarThreadKeys().size).toBe(0);
  });
});
