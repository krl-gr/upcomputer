import { describe, expect, it } from "vite-plus/test";

import {
  describeServerUpToDate,
  isStillUpToDate,
  upToDateReportToRemember,
} from "./serverUpToDate.logic";

const stable = "0.0.37";
const nightly = "0.0.38-nightly.20261108.749";

describe("server up-to-date memory", () => {
  it("remembers only a host on another track, until either version changes", () => {
    const otherTrack = { serverVersion: stable, targetVersion: nightly };
    expect(upToDateReportToRemember(otherTrack)).toEqual(otherTrack);
    expect(isStillUpToDate(otherTrack, stable, nightly)).toBe(true);
    expect(isStillUpToDate(otherTrack, "0.0.38", nightly)).toBe(false);
    expect(isStillUpToDate(otherTrack, stable, "0.0.38-nightly.20261109.750")).toBe(false);

    // Same track: its feed may lag behind a fresh release, so the update stays on offer.
    const sameTrack = { serverVersion: stable, targetVersion: "0.0.38" };
    expect(upToDateReportToRemember(sameTrack)).toBeNull();
    expect(isStillUpToDate(sameTrack, stable, "0.0.38")).toBe(false);
  });

  it("claims the newest build only across tracks", () => {
    const title = (targetVersion: string) =>
      describeServerUpToDate("MacBook", { serverVersion: stable, targetVersion }).title;
    expect(title(nightly)).toBe("MacBook is up to date");
    expect(title("0.0.38")).toBe("Nothing to install on MacBook yet");
  });
});
