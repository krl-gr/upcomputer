import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveProviderSignInCommand } from "./providerSignIn.ts";

const readyCodex: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-08-23T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

describe("resolveProviderSignInCommand", () => {
  it.each([
    ["claudeAgent", "claude auth login"],
    ["codex", "codex login"],
    ["grok", "grok login"],
    ["kiro", "kiro-cli login"],
    ["fx", "fx login"],
    ["cursor", null],
    ["antigravity", null],
    ["opencode", null],
    ["pi", null],
    ["toString", null],
  ])("types only the known sign-in command for %s", (driver, expected) => {
    const provider = {
      driver: ProviderDriverKind.make(driver),
      instanceId: ProviderInstanceId.make(driver),
    };
    expect(resolveProviderSignInCommand(provider, DEFAULT_SERVER_SETTINGS, "darwin")).toBe(
      expected,
    );
  });

  it("uses the selected Codex account binary", () => {
    const provider = { ...readyCodex, instanceId: ProviderInstanceId.make("codex_work") };

    expect(
      resolveProviderSignInCommand(
        provider,
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [provider.instanceId]: {
              driver: provider.driver,
              config: { binaryPath: "/opt/codex-work/bin/codex" },
            },
          },
        },
        "linux",
      ),
    ).toBe("/opt/codex-work/bin/codex login");
  });

  it("quotes a Codex path with spaces for PowerShell", () => {
    expect(
      resolveProviderSignInCommand(
        readyCodex,
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: {
                binaryPath: "C:\\Program Files\\Codex & Tools\\codex.exe",
              },
            },
          },
        },
        "windows",
      ),
    ).toBe("& 'C:\\Program Files\\Codex & Tools\\codex.exe' login");
  });

  it("quotes a Claude path with shell metacharacters on POSIX", () => {
    const provider: ServerProvider = {
      ...readyCodex,
      driver: ProviderDriverKind.make("claudeAgent"),
      instanceId: ProviderInstanceId.make("claude"),
    };

    expect(
      resolveProviderSignInCommand(
        provider,
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("claude")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              config: {
                binaryPath: "/opt/Claude Tools/$current/claude",
              },
            },
          },
        },
        "linux",
      ),
    ).toBe("'/opt/Claude Tools/$current/claude' auth login");
  });

  it.each([
    ["~/my tools/codex", "~/'my tools/codex' login"],
    ["~\\my tools/codex", "~/'my tools/codex' login"],
    ["~/tools/codex's build", `~/'tools/codex'"'"'s build' login`],
    ["~\\tools\\codex's build", `~/'tools\\codex'"'"'s build' login`],
    ["~/tools/codex; echo unsafe", "~/'tools/codex; echo unsafe' login"],
  ])("keeps the home prefix expandable while quoting %s", (binaryPath, expectedCommand) => {
    expect(
      resolveProviderSignInCommand(
        readyCodex,
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: {
                binaryPath,
              },
            },
          },
        },
        "linux",
      ),
    ).toBe(expectedCommand);
  });

  it("uses the default command when an old server reports an unknown shell", () => {
    expect(
      resolveProviderSignInCommand(
        readyCodex,
        {
          ...DEFAULT_SERVER_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("codex")]: {
              driver: ProviderDriverKind.make("codex"),
              config: {
                binaryPath: "/opt/Codex Tools/codex",
              },
            },
          },
        },
        "unknown",
      ),
    ).toBe("codex login");
  });
});
