import type { InteractionModeDescriptor } from "@upcomputer/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  InteractionModeRegistryError,
  InteractionModeResolutionError,
  applyResolvedInteractionModePrompt,
  createExperimentalInteractionModeRegistry,
  extractProposedPlanMarkdown,
  resolveInteractionModeFinalOutput,
} from "./interactionMode.ts";

const makeDescriptor = (
  overrides: Partial<InteractionModeDescriptor> = {},
): InteractionModeDescriptor => ({
  id: "ask",
  ownerId: "upcomputer.core",
  version: 1,
  displayName: "Ask",
  description: "Answer without implementing changes.",
  intent: "answer",
  safety: {
    mutations: "deny",
    sandbox: "inherit-runtime",
    computerUse: "observe-only",
  },
  outputKind: "plain",
  supportedProviders: ["codex", "claudeAgent"],
  unsupportedProviderBehavior: "reject",
  providerBehaviors: [
    {
      providerId: "codex",
      collaborationMode: "default",
      developerInstructions: "Answer only.",
    },
    {
      providerId: "claudeAgent",
      permissionMode: "session-default",
      promptPrefix: "You are in Ask mode.",
      promptInputLabel: "User question:",
    },
  ],
  ...overrides,
});

describe("ExperimentalInteractionModeRegistry", () => {
  it("sorts snapshots deterministically", () => {
    const registry = createExperimentalInteractionModeRegistry([
      { descriptor: makeDescriptor({ id: "plan", displayName: "Plan" }) },
      { descriptor: makeDescriptor({ id: "ask", displayName: "Ask" }) },
    ]);

    expect(registry.snapshot().map((snapshot) => snapshot.id)).toEqual(["ask", "plan"]);
  });

  it.effect("resolves provider behavior", () =>
    Effect.gen(function* () {
      const registry = createExperimentalInteractionModeRegistry([
        { descriptor: makeDescriptor() },
      ]);
      const resolved = yield* registry.resolve("ask", "claudeAgent");

      expect(resolved.id).toBe("ask");
      expect(resolved.provider.providerId).toBe("claudeAgent");
      expect(resolved.provider.permissionMode).toBe("session-default");
      expect(resolved.provider.promptPrefix).toBe("You are in Ask mode.");
      expect(resolved.provider.sandbox).toBe("inherit-runtime");
    }),
  );

  it("applies descriptor prompt prefix and input label", () => {
    const registry = createExperimentalInteractionModeRegistry([{ descriptor: makeDescriptor() }]);
    const resolved = registry.resolveOrThrow("ask", "claudeAgent");

    expect(applyResolvedInteractionModePrompt("What changed?", resolved)).toBe(
      "You are in Ask mode.\n\nUser question:\nWhat changed?",
    );
  });

  it("extracts exactly one proposed plan markdown block", () => {
    expect(
      extractProposedPlanMarkdown("Before\n<proposed_plan>\n# Ship it\n\n- step\n</proposed_plan>"),
    ).toBe("# Ship it\n\n- step");
    expect(extractProposedPlanMarkdown("No block")).toBeUndefined();
    expect(
      extractProposedPlanMarkdown(
        "<proposed_plan># One</proposed_plan>\n<proposed_plan># Two</proposed_plan>",
      ),
    ).toBeUndefined();
  });

  it("resolves proposed-plan final output from tagged markdown", () => {
    const registry = createExperimentalInteractionModeRegistry([
      {
        descriptor: makeDescriptor({
          id: "plan",
          displayName: "Plan",
          intent: "propose",
          outputKind: "proposed-plan",
        }),
      },
    ]);
    const resolved = registry.resolveOrThrow("plan", "codex");

    expect(
      resolveInteractionModeFinalOutput(
        "Summary\n\n<proposed_plan>\n# Ship it\n</proposed_plan>",
        resolved,
      ),
    ).toEqual({
      ownerId: "upcomputer.core",
      modeId: "plan",
      modeVersion: 1,
      outputKind: "proposed-plan",
      output: "# Ship it",
      sourceText: "Summary\n\n<proposed_plan>\n# Ship it\n</proposed_plan>",
    });
  });

  it("resolves structured final output through the registered parser", () => {
    const registry = createExperimentalInteractionModeRegistry([
      {
        descriptor: makeDescriptor({
          id: "orchestrator",
          ownerId: "upcomputer.orchestrator",
          displayName: "Orchestrator",
          intent: "propose",
          safety: {
            mutations: "deny",
            sandbox: "read-only",
            computerUse: "observe-only",
          },
          outputKind: "structured",
        }),
        parseFinalOutput: (text) => (text.includes("ship") ? { action: "ship" } : undefined),
      },
    ]);
    const resolved = registry.resolveOrThrow("orchestrator", "codex");

    expect(resolveInteractionModeFinalOutput("please ship", resolved)).toEqual({
      ownerId: "upcomputer.orchestrator",
      modeId: "orchestrator",
      modeVersion: 1,
      outputKind: "structured",
      output: { action: "ship" },
      sourceText: "please ship",
    });
    expect(resolveInteractionModeFinalOutput("ignore", resolved)).toBeUndefined();
  });

  it("runs a mode that is no longer registered as Default", () => {
    const registry = createExperimentalInteractionModeRegistry([
      { descriptor: makeDescriptor({ id: "default", displayName: "Default" }) },
      { descriptor: makeDescriptor() },
    ]);

    expect(registry.effectiveModeId("ask")).toBe("ask");
    expect(registry.effectiveModeId("orchestrator")).toBe("default");
    expect(
      createExperimentalInteractionModeRegistry([{ descriptor: makeDescriptor() }]).effectiveModeId(
        "orchestrator",
      ),
    ).toBe("orchestrator");
  });

  it("rejects duplicate mode registrations", () => {
    expect(() =>
      createExperimentalInteractionModeRegistry([
        { descriptor: makeDescriptor() },
        { descriptor: makeDescriptor() },
      ]),
    ).toThrow(InteractionModeRegistryError);
  });

  it("rejects extension read-only modes that keep inherited sandbox", () => {
    expect(() =>
      createExperimentalInteractionModeRegistry([
        {
          descriptor: makeDescriptor({
            id: "orchestrator",
            ownerId: "upcomputer.orchestrator",
            safety: {
              mutations: "deny",
              sandbox: "inherit-runtime",
              computerUse: "observe-only",
            },
          }),
        },
      ]),
    ).toThrow(InteractionModeRegistryError);
  });

  it("rejects unsupported provider resolution", () => {
    const registry = createExperimentalInteractionModeRegistry([{ descriptor: makeDescriptor() }]);

    expect(() => registry.resolveOrThrow("ask", "cursor")).toThrow(InteractionModeResolutionError);
    try {
      registry.resolveOrThrow("ask", "cursor");
    } catch (error) {
      expect(error).toBeInstanceOf(InteractionModeResolutionError);
      if (error instanceof InteractionModeResolutionError) {
        expect(error.code).toBe("unsupported-provider");
      }
    }
  });
});
