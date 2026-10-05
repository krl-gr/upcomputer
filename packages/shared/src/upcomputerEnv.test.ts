import { describe, expect, it } from "vite-plus/test";

import { applyUpcomputerEnvAliases } from "./upcomputerEnv.ts";

describe("applyUpcomputerEnvAliases", () => {
  it("maps each UPCOMPUTER_ variable to its T3CODE_ name", () => {
    const env: Record<string, string | undefined> = {
      UPCOMPUTER_HOME: "/Users/alice/.upcomputer",
      UPCOMPUTER_TELEMETRY_ENABLED: "false",
      PATH: "/usr/bin",
    };

    applyUpcomputerEnvAliases(env);

    expect(env).toEqual({
      UPCOMPUTER_HOME: "/Users/alice/.upcomputer",
      UPCOMPUTER_TELEMETRY_ENABLED: "false",
      T3CODE_HOME: "/Users/alice/.upcomputer",
      T3CODE_TELEMETRY_ENABLED: "false",
      PATH: "/usr/bin",
    });
  });

  it("lets the UPCOMPUTER_ value win when both are set", () => {
    const env = applyUpcomputerEnvAliases({
      T3CODE_PORT: "3773",
      UPCOMPUTER_PORT: "4848",
    });

    expect(env.T3CODE_PORT).toBe("4848");
  });

  it("keeps T3CODE_ variables that have no UPCOMPUTER_ alias", () => {
    const env = applyUpcomputerEnvAliases({ T3CODE_PORT: "3773", UPCOMPUTER_HOME: undefined });

    expect(env).toEqual({ T3CODE_PORT: "3773", UPCOMPUTER_HOME: undefined });
  });
});
