import type { BackgroundNotice } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { visibleBackgroundNotices } from "./SidebarBackgroundNotices";

const notice = (id: string, occurredAt: string): BackgroundNotice => ({
  id,
  area: "automations",
  severity: "error",
  title: "Automation turned off",
  message: "Daily report was turned off after 5 failed runs.",
  occurredAt,
});

describe("visibleBackgroundNotices", () => {
  it("merges every computer's notices newest first and hides dismissed occurrences", () => {
    const older = notice("a", "2026-10-28T08:00:00.000Z");
    const newer = notice("b", "2026-10-28T09:00:00.000Z");
    expect(visibleBackgroundNotices([[older], undefined, [newer]], new Set())).toEqual([
      newer,
      older,
    ]);
    expect(
      visibleBackgroundNotices([[older, newer]], new Set(["a@2026-10-28T08:00:00.000Z"])),
    ).toEqual([newer]);
    // The same problem happening again shows again.
    const repeat = notice("a", "2026-10-28T10:00:00.000Z");
    expect(visibleBackgroundNotices([[repeat]], new Set(["a@2026-10-28T08:00:00.000Z"]))).toEqual([
      repeat,
    ]);
  });
});
