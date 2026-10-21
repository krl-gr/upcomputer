import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getProviderStatusKey,
  getProviderSummary,
  getProviderVersionAdvisoryPresentation,
  withoutManagedOpenCodeNote,
} from "./providerStatus";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated", label: "ChatGPT" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("getProviderSummary", () => {
  it("shows a provider whose first check is still running as checking, without a warning", () => {
    // The placeholder a driver publishes at startup: not installed, warning,
    // unknown auth. Before this it read "Not found" or "Needs attention".
    const pending: ServerProvider = {
      ...provider,
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "OpenCode provider status has not been checked in this session yet.",
      statusPending: true,
    };
    expect(getProviderSummary(pending)).toEqual({ headline: "Checking…", detail: null });
    expect(getProviderStatusKey(pending, true)).toBe("checking");
    expect(getProviderStatusKey(undefined, true)).toBe("checking");
    expect(getProviderStatusKey(pending, false)).toBe("disabled");
    expect(getProviderStatusKey({ ...pending, statusPending: false }, true)).toBe("warning");
  });

  it("reports ready providers with unknown authentication as available", () => {
    expect(getProviderSummary({ ...provider, auth: { status: "unknown" } })).toEqual({
      headline: "Available",
      detail: null,
    });
  });

  it("does not hide a provider error behind a previous authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        message: "The provider process failed to start.",
      }),
    ).toEqual({
      headline: "Unavailable",
      detail: "The provider process failed to start.",
    });
  });

  it("does not hide a provider warning behind an authenticated state", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "warning",
        message: "The provider version is unsupported.",
      }),
    ).toEqual({
      headline: "Needs attention",
      detail: "The provider version is unsupported.",
    });
  });

  it("keeps authentication failures actionable when their provider status is error", () => {
    expect(
      getProviderSummary({
        ...provider,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Run codex login.",
      }),
    ).toEqual({
      headline: "Not authenticated",
      detail: "Run codex login.",
    });
  });

  it("treats a disabled provider status as disabled even before its enabled flag updates", () => {
    expect(getProviderSummary({ ...provider, status: "disabled" }).headline).toBe("Disabled");
  });
});

it("does not suggest copying a command that installs an incompatible latest version", () => {
  const advisory = {
    status: "behind_latest" as const,
    currentVersion: "1.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "supported" as const,
    latestVersionStatus: "broken" as const,
    message: null,
    recommendedRange: null,
    recommendedVersion: null,
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, { ...compatibility, status: "broken" }, false),
  ).toBeNull();
  expect(
    getProviderVersionAdvisoryPresentation(advisory, {
      ...compatibility,
      latestVersionStatus: "supported",
    }),
  ).not.toBeNull();
});

it("shows compatibility in the version popover even when the installed version is current", () => {
  const advisory = {
    status: "current" as const,
    currentVersion: "2.0.0",
    latestVersion: "2.0.0",
    updateCommand: "npm install -g fixture@latest",
    canUpdate: true,
    checkedAt: provider.checkedAt,
    message: null,
  };
  const compatibility = {
    status: "broken" as const,
    latestVersionStatus: "broken" as const,
    message: "This version drops turns. Use 1.9.0.",
    recommendedRange: null,
    recommendedVersion: "1.9.0",
  };
  expect(getProviderVersionAdvisoryPresentation(advisory, compatibility)).toEqual({
    title: "Known broken version",
    detail: compatibility.message,
    updateCommand: null,
    emphasis: "strong",
    targetVersion: "1.9.0",
  });
  expect(
    getProviderVersionAdvisoryPresentation(undefined, {
      ...compatibility,
      status: "graceful",
      recommendedVersion: null,
      recommendedRange: ">=2.1.0",
      message: null,
    }),
  ).toEqual({
    title: "Limited support",
    detail: "Use >=2.1.0 for full support.",
    updateCommand: null,
    emphasis: "normal",
    targetVersion: null,
  });
});

describe("provider status copy", () => {
  it("surfaces an ACP-advertised authentication method", () => {
    const provider = {
      enabled: true,
      installed: true,
      status: "error",
      auth: { status: "unauthenticated", type: "agent", label: "Company login" },
      message: "Complete this authentication method on the server.",
    } as ServerProvider;

    expect(getProviderSummary(provider)).toEqual({
      headline: "Not authenticated · Company login",
      detail: "Complete this authentication method on the server.",
    });
  });
});

describe("withoutManagedOpenCodeNote", () => {
  const openCode: ServerProvider = {
    ...provider,
    instanceId: ProviderInstanceId.make("opencode"),
    driver: ProviderDriverKind.make("opencode"),
    version: "1.19.3",
    compatibilityAdvisory: {
      status: "graceful",
      message: "This provider version has limited compatibility with this Up.computer release.",
      recommendedVersion: null,
      recommendedRange: null,
    },
  };
  const managed =
    "/Users/me/Library/Application Support/Up.computer/tools/opencode/1.19.3/opencode";

  it("drops the 1.x note for the OpenCode the app pinned and installed", () => {
    expect(withoutManagedOpenCodeNote(openCode, managed)?.compatibilityAdvisory).toBeUndefined();
    expect(
      withoutManagedOpenCodeNote(openCode, "C:\\Up\\tools\\opencode\\1.19.3\\opencode.exe")
        ?.compatibilityAdvisory,
    ).toBeUndefined();
  });

  it("keeps it for the user's own OpenCode and for any other advisory", () => {
    expect(withoutManagedOpenCodeNote(openCode, "")).toBe(openCode);
    expect(withoutManagedOpenCodeNote(openCode, "/Users/me/.opencode/bin/opencode")).toBe(openCode);
    const other = { ...openCode, version: "1.19.4" };
    expect(withoutManagedOpenCodeNote(other, managed)).toBe(other);
    const broken = {
      ...openCode,
      compatibilityAdvisory: { ...openCode.compatibilityAdvisory!, status: "broken" as const },
    };
    expect(withoutManagedOpenCodeNote(broken, managed)).toBe(broken);
  });
});
