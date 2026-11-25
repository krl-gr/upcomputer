import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";

import { ProviderInstanceIcon } from "../components/chat/ProviderInstanceIcon";
import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { getOnboardingProviderState } from "../onboarding/providerReadiness.logic";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { SwitchAgentAction } from "./AgentSetupOffer";
import { FIRST_RUN_AGENT_INSTANCE_ID } from "./upComputerOnboarding.logic";

/**
 * Under a sign-in the free agent started: once the agent is signed in, moves this
 * chat to it, as picking it in the composer does. The next message goes to it.
 */
export function SwitchChatToSignedInAgent({
  environmentId,
  threadId,
  instanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly instanceId: ProviderInstanceId;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  const thread = useAtomValue(environmentThreadShells.threadShellAtom(threadRef));
  const pickedInstanceId = useComposerDraftStore(
    (store) => store.getComposerDraft(threadRef)?.activeProvider ?? null,
  );
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  const shownInstanceId = pickedInstanceId ?? thread?.modelSelection.instanceId ?? null;
  if (
    !providers ||
    provider === undefined ||
    !provider.enabled ||
    getOnboardingProviderState(provider) !== "ready" ||
    shownInstanceId !== FIRST_RUN_AGENT_INSTANCE_ID
  ) {
    return null;
  }
  const model = resolveAppModelSelectionForInstance(instanceId, settings, providers, null);
  if (model === null) return null;
  const name = resolveProviderInstanceDisplayName(provider);
  return (
    <div className="mt-3 px-1">
      <SwitchAgentAction
        agent={name}
        icon={<ProviderInstanceIcon driverKind={provider.driver} displayName={name} />}
        onSwitch={() => {
          const store = useComposerDraftStore.getState();
          const selection = { instanceId, model };
          store.setModelSelection(threadRef, selection, { explicit: true, replaceOptions: true });
          store.setStickyModelSelection(selection);
        }}
      />
    </div>
  );
}
