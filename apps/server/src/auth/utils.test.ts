import { describe, expect, it } from "vite-plus/test";

import {
  deriveAuthClientMetadata,
  resolveLegacySessionCookieName,
  resolveSessionCookieName,
} from "./utils.ts";

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) upcomputer/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("applies client-presented display identity without replacing transport metadata", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:192.168.213.72",
        },
      } as never,
      presented: {
        label: "Up.computer Mobile",
        deviceType: "mobile",
        os: "iOS",
      },
    });

    expect(metadata).toMatchObject({
      label: "Up.computer Mobile",
      browser: "Electron",
      deviceType: "mobile",
      ipAddress: "192.168.213.72",
      os: "iOS",
    });
    expect(metadata.userAgent).toContain("Electron/36.3.2");
  });
});

describe("session cookie isolation", () => {
  const base = {
    mode: "web",
    port: 5775,
    host: "127.0.0.1",
    instanceKey: "/tmp/up-agent-one",
    environmentId: "environment-one",
    development: true,
  } as const;

  it("isolates loopback development servers that reuse a port", () => {
    const first = resolveSessionCookieName(base);
    const second = resolveSessionCookieName({
      ...base,
      instanceKey: "/tmp/up-agent-two",
      environmentId: "environment-two",
    });

    expect(first).toMatch(/^upcomputer_session_5775_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("isolates remote web servers on one host", () => {
    const first = resolveSessionCookieName({
      ...base,
      port: 3773,
      host: "192.168.1.50",
      instanceKey: "/srv/up-one",
      development: false,
    });
    const second = resolveSessionCookieName({
      ...base,
      host: "192.168.1.50",
      instanceKey: "/srv/up-two",
      environmentId: "environment-two",
      development: false,
    });

    expect(first).toMatch(/^upcomputer_session_[a-f0-9]{12}$/);
    expect(second).toMatch(/^upcomputer_session_[a-f0-9]{12}$/);
    expect(first).not.toBe(second);
  });

  it("keeps a remote web server cookie stable across port changes", () => {
    const remote = { ...base, instanceKey: "/srv/up", development: false } as const;
    expect(resolveSessionCookieName({ ...remote, port: 8080, host: "0.0.0.0" })).toBe(
      resolveSessionCookieName({ ...remote, port: 9090, host: "app.example.com" }),
    );
  });

  it("retains desktop port scoping", () => {
    expect(resolveSessionCookieName({ ...base, mode: "desktop", port: 3773 })).toBe(
      "upcomputer_session_3773",
    );
    expect(resolveLegacySessionCookieName({ ...base, mode: "desktop" })).toBeUndefined();
  });

  it("keeps a wildcard development server instance-scoped", () => {
    expect(resolveSessionCookieName({ ...base, host: "0.0.0.0" })).toMatch(
      /^upcomputer_session_5775_[a-f0-9]{12}$/,
    );
  });

  it("names the pre-upgrade web cookie so existing sessions migrate", () => {
    expect(resolveLegacySessionCookieName({ ...base, development: false })).toBe(
      "upcomputer_session",
    );
    expect(resolveLegacySessionCookieName(base)).toBe("upcomputer_session_5775");
  });
});
