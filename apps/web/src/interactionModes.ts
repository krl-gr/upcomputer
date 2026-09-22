import { InteractionModeId, type ProviderInteractionMode } from "@upcomputer/contracts";
import * as Schema from "effect/Schema";

export interface InteractionModePresentation {
  readonly id: ProviderInteractionMode;
  readonly label: string;
  readonly description: string;
  readonly available: boolean;
}

export const CORE_INTERACTION_MODE_PRESENTATIONS: ReadonlyArray<InteractionModePresentation> =
  Object.freeze([
    {
      id: "default",
      label: "Build",
      description: "Execute changes normally.",
      available: true,
    },
    {
      id: "ask",
      label: "Ask",
      description: "Answer only, no edits, commands, or plans.",
      available: true,
    },
    {
      id: "plan",
      label: "Plan",
      description: "Produce implementation plans.",
      available: true,
    },
  ]);

export const INTERACTION_MODE_ORDER = CORE_INTERACTION_MODE_PRESENTATIONS.map(({ id }) => id);

export const interactionModeConfig: Readonly<
  Record<string, Pick<InteractionModePresentation, "label" | "description">>
> = Object.fromEntries(
  CORE_INTERACTION_MODE_PRESENTATIONS.map(({ id, label, description }) => [
    id,
    { label, description },
  ]),
);

const isInteractionModeId = Schema.is(InteractionModeId);

/** Validates the open wire identifier without requiring local availability. */
export function isProviderInteractionMode(value: unknown): value is ProviderInteractionMode {
  return isInteractionModeId(value);
}

export function unavailableInteractionModePresentation(
  mode: ProviderInteractionMode,
): InteractionModePresentation {
  return {
    id: mode,
    label: "Unavailable mode",
    description: `Interaction mode '${mode}' is not available for this build, server, or provider.`,
    available: false,
  };
}

export function resolveInteractionModePresentation(
  mode: ProviderInteractionMode,
  presentations: ReadonlyArray<InteractionModePresentation> = CORE_INTERACTION_MODE_PRESENTATIONS,
): InteractionModePresentation {
  return (
    presentations.find((presentation) => presentation.id === mode) ??
    unavailableInteractionModePresentation(mode)
  );
}

export function getInteractionModeLabel(mode: ProviderInteractionMode): string {
  return resolveInteractionModePresentation(mode).label;
}

export function nextProviderInteractionMode(
  mode: ProviderInteractionMode,
  presentations: ReadonlyArray<InteractionModePresentation> = CORE_INTERACTION_MODE_PRESENTATIONS,
): ProviderInteractionMode {
  const available = presentations.filter((presentation) => presentation.available);
  if (available.length === 0) return mode;
  const index = available.findIndex((presentation) => presentation.id === mode);
  return available[(index + 1 + available.length) % available.length]?.id ?? mode;
}
