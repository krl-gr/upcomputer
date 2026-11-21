import * as NodeEvents from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";

import { keepDrivenGuestPainting } from "./BackgroundThrottlingHolds.ts";

let nextId = 1;

function makeContents(input: { throttled?: boolean; host?: unknown } = {}) {
  let throttled = input.throttled ?? true;
  const setBackgroundThrottling = vi.fn((allowed: boolean) => {
    throttled = allowed;
  });
  const contents = Object.assign(new NodeEvents.EventEmitter(), {
    id: nextId++,
    hostWebContents: input.host ?? null,
    isDestroyed: () => false,
    getBackgroundThrottling: () => throttled,
    setBackgroundThrottling,
  });
  return { contents, calls: setBackgroundThrottling.mock.calls, guest: contents as never };
}

describe("keepDrivenGuestPainting", () => {
  it("leaves throttling alone outside Windows", () => {
    const host = makeContents();
    const guest = makeContents({ host: host.contents });
    keepDrivenGuestPainting(guest.guest, true, "darwin");
    keepDrivenGuestPainting(guest.guest, true, "linux");
    expect(guest.calls).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  it("keeps the app window unthrottled until its last driven guest is released", () => {
    const host = makeContents();
    const first = makeContents({ host: host.contents });
    const second = makeContents({ host: host.contents });

    keepDrivenGuestPainting(first.guest, true, "win32");
    keepDrivenGuestPainting(first.guest, true, "win32");
    keepDrivenGuestPainting(second.guest, true, "win32");
    expect(first.calls).toEqual([[false]]);
    expect(second.calls).toEqual([[false]]);
    expect(host.calls).toEqual([[false]]);

    keepDrivenGuestPainting(first.guest, false, "win32");
    expect(first.calls).toEqual([[false], [true]]);
    expect(host.calls).toEqual([[false]]);

    keepDrivenGuestPainting(second.guest, false, "win32");
    keepDrivenGuestPainting(second.guest, false, "win32");
    expect(second.calls).toEqual([[false], [true]]);
    expect(host.calls).toEqual([[false], [true]]);
  });

  it("never re-enables throttling it did not turn off", () => {
    const host = makeContents({ throttled: false });
    const guest = makeContents({ host: host.contents, throttled: false });

    keepDrivenGuestPainting(guest.guest, true, "win32");
    keepDrivenGuestPainting(guest.guest, false, "win32");
    expect(guest.calls).toEqual([]);
    expect(host.calls).toEqual([]);
  });

  it("releases the app window when a driven guest is destroyed", () => {
    const host = makeContents();
    const guest = makeContents({ host: host.contents });

    keepDrivenGuestPainting(guest.guest, true, "win32");
    guest.contents.emit("destroyed");
    expect(host.calls).toEqual([[false], [true]]);

    keepDrivenGuestPainting(guest.guest, false, "win32");
    expect(host.calls).toEqual([[false], [true]]);
    expect(guest.calls).toEqual([[false]]);
  });
});
