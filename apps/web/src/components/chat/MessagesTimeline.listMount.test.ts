import { expect, it } from "vite-plus/test";

import { resolveTimelineListMount } from "./MessagesTimeline.logic";

it("skips the scroll to the end only for a list that mounts on a message just sent", () => {
  // LT23: after the first message the docked composer sat over an empty
  // thread for about 0.23 s while LegendList waited for that scroll.
  const first = resolveTimelineListMount(null, {
    listShown: true,
    identity: "env:thread",
    anchoring: true,
  });
  expect(first).toEqual({ identity: "env:thread", forSentMessage: true });
  // The anchor clears once the message is placed; the mounted list keeps its value.
  expect(
    resolveTimelineListMount(first, { listShown: true, identity: "env:thread", anchoring: false }),
  ).toBe(first);
});

it("never changes a mounted list when a later message is sent", () => {
  const opened = resolveTimelineListMount(null, {
    listShown: true,
    identity: "env:thread",
    anchoring: false,
  });
  expect(opened?.forSentMessage).toBe(false);
  expect(
    resolveTimelineListMount(opened, { listShown: true, identity: "env:thread", anchoring: true }),
  ).toBe(opened);
});

it("decides again for another thread or after the empty state", () => {
  const sent = { identity: "env:a", forSentMessage: true };
  expect(
    resolveTimelineListMount(sent, { listShown: true, identity: "env:b", anchoring: false }),
  ).toEqual({ identity: "env:b", forSentMessage: false });
  expect(
    resolveTimelineListMount(sent, { listShown: false, identity: "env:a", anchoring: false }),
  ).toBeNull();
});
