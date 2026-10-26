import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";
import {
  ClientTelemetryEvent,
  OtlpEndpointCheckInput,
  resolveEnvironmentMachineKind,
  ServerObservability,
  ServerProvider,
  ServerProviders,
  toTelemetryProvider,
} from "./server.ts";
import { ServerSettings } from "./settings.ts";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeServerProviders = Schema.decodeUnknownSync(ServerProviders);

const baseProviderSnapshot = {
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-10T00:00:00.000Z",
  models: [],
};

describe("ServerProvider", () => {
  it("preserves installed-version presence through the provider wire codec", () => {
    const encode = Schema.encodeSync(ServerProvider);
    for (const installation of [{}, { installedVersion: null }, { installedVersion: "1.2.3" }]) {
      const decoded = decodeServerProvider({ ...baseProviderSnapshot, ...installation });
      const wire = JSON.parse(JSON.stringify(encode(decoded)));
      expect(wire).toMatchObject({ version: "1.0.0", ...installation });
      expect(Object.hasOwn(wire, "installedVersion")).toBe(
        Object.hasOwn(installation, "installedVersion"),
      );
      expect(decodeServerProvider(wire)).toEqual(decoded);
    }
  });
});

describe("server config forward compatibility", () => {
  it("drops providers this build cannot decode instead of failing the whole array", () => {
    const decodedBase = decodeServerProvider(baseProviderSnapshot);

    const parsed = decodeServerProviders([
      baseProviderSnapshot,
      { ...baseProviderSnapshot, instanceId: "future", status: "some-future-status" },
    ]);

    expect(parsed).toEqual([decodedBase]);
  });

  it("drops usage windows this build cannot decode instead of failing the provider", () => {
    const parsed = decodeServerProvider({
      ...baseProviderSnapshot,
      usageLimits: {
        checkedAt: "2026-04-10T00:00:00.000Z",
        windows: [
          { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
          { id: "future", kind: "some-future-kind", label: "Future", usedPercent: 1 },
          { id: "bad", kind: "weekly", label: "Weekly", usedPercent: 120 },
        ],
      },
    });

    expect(parsed.usageLimits?.windows).toEqual([
      { id: "primary", kind: "session", label: "Session", usedPercent: 12 },
    ]);
  });
});

describe("ServerObservability", () => {
  const decodeServerObservability = Schema.decodeUnknownSync(ServerObservability);

  it("rejects an unknown endpoint source", () => {
    expect(() =>
      decodeServerObservability({
        logsDirectoryPath: "/tmp/t3/logs",
        localTracingEnabled: true,
        otlpTracesUrl: "https://collector.example.com/v1/traces",
        otlpTracesSource: "cli",
        otlpTracesEnabled: true,
        otlpMetricsEnabled: false,
      }),
    ).toThrow();
  });
});

describe("resolveEnvironmentMachineKind", () => {
  const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
  const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
  const descriptor = (platform: Record<string, unknown>) =>
    decodeDescriptor({
      environmentId: "env-1",
      label: "Box",
      platform: { os: "linux", arch: "x64", ...platform },
      serverVersion: "1.0.0",
      capabilities: {},
    });

  it("prefers the user's pick over what the server detected", () => {
    expect(
      resolveEnvironmentMachineKind({
        environment: descriptor({ machine: "mac-mini" }),
        settings: decodeSettings({ environmentIcon: "laptop" }),
      }),
    ).toBe("laptop");
  });

  it("drops a machine kind this build does not know instead of failing the descriptor", () => {
    const parsed = descriptor({ machine: "toaster" });

    expect(parsed.platform.machine).toBeUndefined();
    expect(
      resolveEnvironmentMachineKind({ environment: parsed, settings: decodeSettings({}) }),
    ).toBe("server");
  });
});

describe("OtlpEndpointCheckInput", () => {
  const decode = Schema.decodeUnknownSync(OtlpEndpointCheckInput);

  it("accepts HTTP receivers only", () => {
    expect(decode({ signal: "traces", url: "https://collector.example.com/v1/traces" }).url).toBe(
      "https://collector.example.com/v1/traces",
    );
    for (const url of ["data:text/plain,ok", "file:///etc/hosts", "collector:4318/v1/traces"]) {
      expect(() => decode({ signal: "traces", url })).toThrow();
    }
  });
});

describe("ClientTelemetryEvent", () => {
  const decode = Schema.decodeUnknownExit(ClientTelemetryEvent);

  it("accepts only shipped drivers or other as the provider", () => {
    const action = { event: "onboarding.agent.action", action: "sign_in" };
    expect(decode({ ...action, provider: "opencode" })._tag).toBe("Success");
    expect(decode({ ...action, provider: "other" })._tag).toBe("Success");
    expect(decode({ ...action, provider: "private-customer-alice-123" })._tag).toBe("Failure");
    expect(decode({ event: "composer.provider_setup.clicked", target: "acme-project" })._tag).toBe(
      "Failure",
    );
  });

  it("carries only the threshold on a first screen left idle", () => {
    const idle = { event: "onboarding.first_screen_idle" };
    expect(decode({ ...idle, thresholdMs: 180_000 })._tag).toBe("Success");
    expect(decode({ ...idle, thresholdMs: 0 })._tag).toBe("Failure");
    expect(decode(idle)._tag).toBe("Failure");
  });

  it("maps a driver this app does not ship to other", () => {
    expect(toTelemetryProvider("claudeAgent")).toBe("claudeAgent");
    expect(toTelemetryProvider("private-customer-alice-123")).toBe("other");
  });
});
