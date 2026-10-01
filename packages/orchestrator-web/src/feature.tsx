import {
  ORCHESTRATOR_PROPOSAL_READS_RPC_CAPABILITY_ID,
  ORCHESTRATOR_PROPOSALS_RPC_CAPABILITY_ID,
} from "@upcomputer/tasks-contracts/v1";
import { ORCHESTRATOR_UI_METADATA } from "@upcomputer/orchestrator/ui";
import {
  ORCHESTRATOR_INTERACTION_MODE_CAPABILITY_ID,
  ORCHESTRATOR_INTERACTION_MODE_DESCRIPTOR,
} from "@upcomputer/orchestrator";

import { defineExperimentalWebFeature } from "../../../apps/web/src/extensionApi.ts";

const exactTasksCapability = (id: string) =>
  ({
    id,
    minimum: 1,
    maximum: 1,
    ownerId: "upcomputer.tasks",
  }) as const;

const exactOrchestratorCapability = (id: string) =>
  ({
    id,
    minimum: 1,
    maximum: 1,
    ownerId: "upcomputer.orchestrator",
  }) as const;

// Keep proposal rendering and existing Orchestrator threads available while
// temporarily removing the mode from the composer.
const ORCHESTRATOR_COMPOSER_MODE_ENABLED: boolean = false;

export const ORCHESTRATOR_WEB_FEATURE = defineExperimentalWebFeature({
  id: "upcomputer.orchestrator.web",
  ownerId: "upcomputer.orchestrator",
  extensionId: "upcomputer.orchestrator",
  version: 1,
  interactionModes: ORCHESTRATOR_COMPOSER_MODE_ENABLED
    ? [
        {
          id: ORCHESTRATOR_UI_METADATA.id,
          label: ORCHESTRATOR_UI_METADATA.displayName,
          description: ORCHESTRATOR_UI_METADATA.description,
          order: 50,
          supportedProviders: ORCHESTRATOR_INTERACTION_MODE_DESCRIPTOR.supportedProviders,
          capabilities: [exactOrchestratorCapability(ORCHESTRATOR_INTERACTION_MODE_CAPABILITY_ID)],
        },
      ]
    : [],
  proposedPlanRenderers: [
    {
      id: "orchestration-proposal",
      order: 10,
      capabilities: [exactTasksCapability(ORCHESTRATOR_PROPOSAL_READS_RPC_CAPABILITY_ID)],
      load: () => import("./adapters/ProposedPlanRenderer.tsx"),
    },
  ],
  composerBanners: [
    {
      id: "orchestration-proposal-ready",
      order: 10,
      capabilities: [
        exactTasksCapability(ORCHESTRATOR_PROPOSAL_READS_RPC_CAPABILITY_ID),
        exactTasksCapability(ORCHESTRATOR_PROPOSALS_RPC_CAPABILITY_ID),
      ],
      load: () => import("./adapters/ComposerBanner.tsx"),
    },
  ],
});
