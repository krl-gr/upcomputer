import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { buildTraitsTriggerDisplay, buildUnavailableModelOptionDescriptors } from "./TraitsPicker";

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

function serviceTierDescriptor(
  currentValue: "default" | "priority" | "ultrafast" | "flex",
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "ultrafast", label: "Ultrafast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  };
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

function display(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  return buildTraitsTriggerDisplay({
    provider: CODEX,
    descriptors,
    primarySelectDescriptorId: "reasoningEffort",
    ultrathinkPromptControlled: false,
  });
}

it("shows Default for an unchosen variant until a matching provider report names it", () => {
  const selection = {
    instanceId: ProviderInstanceId.make("opencode"),
    model: "ling",
    options: [],
  };
  const input = {
    provider: ProviderDriverKind.make("opencode"),
    descriptors: [
      selectDescriptor(
        "variant",
        [
          { id: "none", label: "None" },
          { id: "thinking", label: "Thinking" },
        ],
        "",
      ),
    ],
    primarySelectDescriptorId: "variant",
    ultrathinkPromptControlled: false,
    modelSelection: selection,
  };
  expect(buildTraitsTriggerDisplay(input).label).toBe("Default");
  expect(
    buildTraitsTriggerDisplay({
      ...input,
      reportedModelSelection: { ...selection, options: [{ id: "variant", value: "default" }] },
    }).label,
  ).toBe("Default");
  expect(
    buildTraitsTriggerDisplay({
      ...input,
      reportedModelSelection: { ...selection, options: [{ id: "variant", value: "thinking" }] },
    }).label,
  ).toBe("Thinking");
});
