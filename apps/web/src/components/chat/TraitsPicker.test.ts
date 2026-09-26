import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ProviderOptionDescriptor } from "@upcomputer/contracts";
import {
  buildTraitsTriggerDisplay,
  buildUnavailableModelOptionDescriptors,
  getTraitsTriggerPresentation,
} from "./TraitsPicker";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

function fastModeDescriptor(
  currentValue: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue };
}

const EFFORT = selectDescriptor(
  "reasoningEffort",
  [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  "high",
);
const CONTEXT_WINDOW = selectDescriptor(
  "contextWindow",
  [
    { id: "200k", label: "200k" },
    { id: "1m", label: "1M" },
  ],
  "1m",
);

const CODEX = ProviderDriverKind.make("codex");

function display(descriptors: ReadonlyArray<ProviderOptionDescriptor>, fastModeEnabled: boolean) {
  return buildTraitsTriggerDisplay({
    provider: CODEX,
    descriptors,
    primarySelectDescriptorId: "reasoningEffort",
    ultrathinkPromptControlled: false,
    fastModeEnabled,
  });
}

describe("traits trigger presentation", () => {
  it("keeps the composer affordance and responsive width cap", () => {
    const presentation = getTraitsTriggerPresentation({
      provider: "codex" as ProviderDriverKind,
      presentation: "composer",
    });

    expect(presentation.showChevron).toBe(true);
    expect(presentation.triggerClassName).toContain("max-w-40");
    expect(presentation.triggerClassName).toContain("sm:max-w-48");
    expect(presentation.triggerClassName).toContain("text-muted-foreground/70");
  });

  it("uses the uncapped foreground detail-row contract without a chevron", () => {
    const presentation = getTraitsTriggerPresentation({
      provider: "codex" as ProviderDriverKind,
      presentation: "detail-row",
    });

    expect(presentation.showChevron).toBe(false);
    expect(presentation.triggerClassName).toContain("w-full");
    expect(presentation.triggerClassName).toContain("min-w-0");
    expect(presentation.triggerClassName).toContain("justify-end");
    expect(presentation.triggerClassName).toContain("!bg-transparent");
    expect(presentation.triggerClassName).toContain("!text-foreground");
    expect(presentation.triggerClassName).not.toContain("max-w-40");
    expect(presentation.triggerClassName).not.toContain("sm:max-w-48");
    expect(presentation.triggerClassName).not.toContain("text-muted-foreground");
  });
});

describe("buildTraitsTriggerDisplay", () => {
  it("omits fast mode from the label entirely when it is off", () => {
    expect(display([EFFORT, fastModeDescriptor(false), CONTEXT_WINDOW], false)).toEqual({
      label: "High · 1M",
      showFastModeIcon: false,
    });
  });

  it("shows the bolt instead of a text label when fast mode is on", () => {
    expect(display([EFFORT, fastModeDescriptor(true), CONTEXT_WINDOW], true)).toEqual({
      label: "High · 1M",
      showFastModeIcon: true,
    });
  });

  it("omits Codex's default Standard tier beside reasoning", () => {
    const serviceTier = selectDescriptor(
      "serviceTier",
      [{ id: "default", label: "Standard", isDefault: true }],
      "default",
    );

    expect(display([EFFORT, serviceTier], false).label).toBe("High");
  });

  it("keeps non-fastMode booleans as text labels", () => {
    const thinking: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    };
    expect(display([EFFORT, thinking], false)).toEqual({
      label: "High · Thinking On",
      showFastModeIcon: false,
    });
  });

  it("falls back to a text label when fast mode is the only trait", () => {
    expect(display([fastModeDescriptor(true)], true)).toEqual({
      label: "Fast",
      showFastModeIcon: false,
    });
    expect(display([fastModeDescriptor(false)], false)).toEqual({
      label: "Normal",
      showFastModeIcon: false,
    });
  });

  it("stays blank when descriptors resolve to no label and there is no fast mode", () => {
    // A select with neither a currentValue nor an isDefault option yields no
    // label. Without a fastMode descriptor present that must stay blank rather
    // than falling through to a bogus "Normal".
    const unresolved: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: "effort",
      label: "effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    };
    expect(display([unresolved], false)).toEqual({ label: "", showFastModeIcon: false });
  });

  it("still renders the prompt-controlled ultrathink label alongside the bolt", () => {
    expect(
      buildTraitsTriggerDisplay({
        provider: CODEX,
        descriptors: [EFFORT, fastModeDescriptor(true)],
        primarySelectDescriptorId: "reasoningEffort",
        ultrathinkPromptControlled: true,
        fastModeEnabled: true,
      }),
    ).toEqual({ label: "Ultrathink", showFastModeIcon: true });
  });
});

describe("buildUnavailableModelOptionDescriptors", () => {
  it("shows only saved values without inventing alternatives", () => {
    expect(
      buildUnavailableModelOptionDescriptors([
        { id: "variant", value: "max" },
        { id: "agent", value: "build" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      {
        id: "variant",
        label: "Variant",
        type: "select",
        options: [{ id: "max", label: "max" }],
        currentValue: "max",
      },
      {
        id: "agent",
        label: "Agent",
        type: "select",
        options: [{ id: "build", label: "build" }],
        currentValue: "build",
      },
      {
        id: "fastMode",
        label: "Fast Mode",
        type: "boolean",
        currentValue: true,
      },
    ]);
  });
});
