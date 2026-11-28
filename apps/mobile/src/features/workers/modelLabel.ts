import {
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";

/** "Claude Code · Claude Sonnet 5.5", as the desktop names a worker's or a run's model. */
export function modelSelectionLabel(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): string {
  const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
  if (!provider) return selection.model;
  const name = PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.displayName ?? provider.driver;
  const model = provider.models.find((entry) => entry.slug === selection.model);
  return `${provider.displayName ?? name} · ${model?.name ?? selection.model}`;
}
