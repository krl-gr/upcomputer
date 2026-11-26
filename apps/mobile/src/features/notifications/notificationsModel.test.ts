import { EnvironmentId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { computerOutages, providerUpdates } from "./notificationsModel";

const provider = (driver: string, instanceId: string, latestVersion: string) =>
  ({
    driver,
    instanceId,
    version: "1.0.0",
    versionAdvisory: { latestVersion },
  }) as unknown as ServerProvider;

const machine = (
  id: string,
  phase: "connected" | "reconnecting" | "error" | "connecting",
  providers: ServerProvider[] = [],
) => ({ environmentId: EnvironmentId.make(id), label: id, phase, providers });

describe("notifications model", () => {
  it("lists dropped computers, not ones still making their first connection", () => {
    expect(
      computerOutages([
        machine("air", "reconnecting"),
        machine("mini", "error"),
        machine("studio", "connecting"),
        machine("pro", "connected"),
      ]).map((outage) => [outage.label, outage.stopped]),
    ).toEqual([
      ["air", false],
      ["mini", true],
    ]);
  });

  it("gives one update card per driver on connected computers, naming them when several", () => {
    const updatable = () => true;
    const one = providerUpdates(
      [
        machine("air", "connected", [
          provider("claudeAgent", "claudeAgent", "2.1.13"),
          provider("claudeAgent", "claude-work", "2.1.13"),
        ]),
        machine("mini", "reconnecting", [provider("codex", "codex", "0.9.0")]),
      ],
      updatable,
    );
    expect(one.map((update) => [update.instanceId, update.machineLabel])).toEqual([
      ["claudeAgent", null],
    ]);
    const two = providerUpdates(
      [
        machine("air", "connected", [provider("codex", "codex", "0.9.0")]),
        machine("mini", "connected", [provider("codex", "codex", "0.9.0")]),
      ],
      updatable,
    );
    expect(two.map((update) => update.machineLabel)).toEqual(["air", "mini"]);
  });
});
