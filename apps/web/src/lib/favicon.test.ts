import { describe, expect, it } from "vite-plus/test";

import { faviconUrlForOrigin } from "./favicon";

describe("faviconUrlForOrigin", () => {
  it.each([
    "http://192.168.1.10:8080",
    "http://localhost:3000",
    "http://home.arpa",
    "https://printer.local.",
    "https://api.internal",
    "https://box.tailnet.ts.net",
    "http://127.1",
    "http://0x7f000001",
    "http://[::]",
    "http://[::1]",
    "http://[::ffff:192.168.1.10]",
    "http://[fd00::1]",
    "http://[fe80::1]",
    "http://100.64.0.1",
    "http://198.51.100.1",
    "http://[2001:db8::1]",
    "http://service.test",
    "http://private.onion",
    "http://127.1..",
  ])("does not disclose %s to the favicon provider", (origin) => {
    expect(faviconUrlForOrigin(origin)).toBeNull();
  });

  it("keeps the public origin, port and requested size", () => {
    expect(faviconUrlForOrigin("https://github.com:8443/pingdotgg/t3code?private=query", 64)).toBe(
      "https://www.google.com/s2/favicons?domain=github.com%3A8443&sz=64",
    );
  });

  it.each([null, undefined, "", "invalid URL", "file:///tmp/private", "data:text/plain,private"])(
    "rejects an invalid or unsupported origin %s",
    (origin) => {
      expect(faviconUrlForOrigin(origin)).toBeNull();
    },
  );
});
