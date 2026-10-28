import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import {
  getProviderStatusBannerKey,
  getProviderStatusMessage,
  shouldShowProviderStatusBanner,
} from "./ProviderStatusBanner";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex-work"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-22T00:00:00Z",
  models: [],
  skills: [],
  slashCommands: [],
  compatibilityAdvisory: {
    status: "unsupported",
    message: "Unsupported version. Use 2.0.0.",
    recommendedVersion: "2.0.0",
    recommendedRange: null,
  },
};

describe("compatibility banners", () => {
  it("shows and dismisses a warning on a healthy provider, then clears it after policy relaxation", () => {
    expect(shouldShowProviderStatusBanner(provider, null)).toBe(true);
    expect(shouldShowProviderStatusBanner(provider, getProviderStatusBannerKey(provider))).toBe(
      false,
    );
    expect(
      shouldShowProviderStatusBanner(
        { ...provider, version: "1.0.1" },
        getProviderStatusBannerKey(provider),
      ),
    ).toBe(true);
    const relaxed: ServerProvider = {
      ...provider,
      compatibilityAdvisory: {
        ...provider.compatibilityAdvisory!,
        status: "supported",
        message: null,
      },
    };
    expect(getProviderStatusBannerKey(relaxed)).toBeNull();
    expect(getProviderStatusBannerKey({ ...provider, status: "disabled" })).toBeNull();
    expect(
      getProviderStatusBannerKey({
        ...provider,
        compatibilityAdvisory: { ...provider.compatibilityAdvisory!, status: "graceful" },
      }),
    ).toBeNull();
  });

  it("shows downgrade guidance instead of a broken OpenCode inventory timeout", () => {
    const message = "This provider version is known to be incompatible. Use 1.14.19.";
    const broken: ServerProvider = {
      ...provider,
      driver: ProviderDriverKind.make("opencode"),
      version: "2.0.3",
      status: "error",
      auth: { status: "unknown" },
      message: "Failed to load OpenCode provider inventory: Timed out waiting for server start.",
      compatibilityAdvisory: {
        status: "broken",
        message,
        recommendedVersion: "1.14.19",
        recommendedRange: ">=1.14.19 <2.0.0",
      },
    };
    expect(shouldShowProviderStatusBanner(broken, null)).toBe(true);
    const timeoutOnly: ServerProvider = {
      ...broken,
      compatibilityAdvisory: {
        ...broken.compatibilityAdvisory!,
        status: "supported",
        message: null,
      },
    };
    expect(shouldShowProviderStatusBanner(broken, getProviderStatusBannerKey(timeoutOnly))).toBe(
      true,
    );
    expect(shouldShowProviderStatusBanner(broken, getProviderStatusBannerKey(broken))).toBe(false);
    expect(
      shouldShowProviderStatusBanner(
        {
          ...broken,
          compatibilityAdvisory: { ...broken.compatibilityAdvisory!, message: "Use 1.14.20." },
        },
        getProviderStatusBannerKey(broken),
      ),
    ).toBe(true);
    expect(getProviderStatusMessage(broken)).toBe(message);
    expect(
      getProviderStatusMessage({
        ...broken,
        compatibilityAdvisory: {
          ...broken.compatibilityAdvisory!,
          status: "supported",
          message: null,
        },
      }),
    ).toBe(broken.message);
    expect(getProviderStatusMessage({ ...broken, auth: { status: "unauthenticated" } })).toBe(
      broken.message,
    );
  });

  it("keeps authentication failures ahead of compatibility warnings even without a probe message", () => {
    const unauthenticated: ServerProvider = {
      ...provider,
      status: "error",
      auth: { status: "unauthenticated" },
    };
    expect(getProviderStatusMessage(unauthenticated)).toBe(
      "Codex isn't signed in on this computer, so it can't run. Sign in again from a terminal on this computer.",
    );
    expect(getProviderStatusMessage({ ...unauthenticated, message: "Credentials expired" })).toBe(
      "Credentials expired",
    );
  });
});

describe("pending provider status", () => {
  const checking = (driver: string, installed: boolean, message: string): ServerProvider => {
    const { compatibilityAdvisory: _advisory, ...base } = provider;
    return {
      ...base,
      instanceId: ProviderInstanceId.make(driver),
      driver: ProviderDriverKind.make(driver),
      installed,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message,
      statusPending: true,
    };
  };
  const placeholders = [
    checking("codex", false, "Codex provider status has not been checked in this session yet."),
    checking(
      "claudeAgent",
      false,
      "Claude provider status has not been checked in this session yet.",
    ),
    checking(
      "opencode",
      false,
      "OpenCode provider status has not been checked in this session yet.",
    ),
    checking("cursor", true, "Checking Cursor SDK availability..."),
    checking("grok", true, "Checking Grok CLI availability..."),
    checking("pi", true, "Checking Pi CLI availability..."),
    checking("muse", true, "Checking Muse Code CLI availability..."),
  ];

  it("shows no banner for a provider that has not been checked yet", () => {
    for (const placeholder of placeholders) {
      expect(getProviderStatusBannerKey(placeholder)).toBeNull();
    }
  });

  it("still shows real results after a check", () => {
    const { statusPending: _pending, ...openCode } = placeholders[2]!;
    const results: ReadonlyArray<ServerProvider> = [
      { ...openCode, status: "error", message: "OpenCode CLI (`opencode`) was not found on PATH." },
      {
        ...openCode,
        installed: true,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Sign in to OpenCode.",
      },
      { ...openCode, installed: true, status: "warning", message: "Could not list models." },
      {
        ...openCode,
        installed: true,
        version: "2.0.3",
        status: "ready",
        auth: { status: "authenticated" },
        compatibilityAdvisory: {
          status: "broken",
          message: "Use 1.14.19.",
          recommendedVersion: "1.14.19",
          recommendedRange: null,
        },
      },
    ];
    for (const result of results) {
      expect(getProviderStatusBannerKey(result)).not.toBeNull();
    }
    expect(
      getProviderStatusBannerKey({ ...openCode, enabled: false, status: "disabled" }),
    ).toBeNull();
  });
});
