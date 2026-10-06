import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useCallback } from "react";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useClientSettings } from "../hooks/useSettings";
import { hasExplicitComposerModelSelection } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useEnvironments } from "../state/environments";

/**
 * Moves an unsent draft into a project in place, as the draft headline's
 * project menu does (`DraftHeroHeadline`'s `selectProject`): same draft and
 * prompt, the project's folder, and its default model unless one was chosen.
 */
export function useRetargetDraftToProject() {
  const { environments } = useEnvironments();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  return useCallback(
    (draftId: DraftId, project: EnvironmentProject) => {
      const store = useComposerDraftStore.getState();
      const currentDraft = store.getComposerDraft(draftId);
      store.setLogicalProjectDraftThreadId(
        deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
        scopeProjectRef(project.environmentId, project.id),
        draftId,
      );
      if (hasExplicitComposerModelSelection(currentDraft)) return;
      store.applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultModelSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      if (defaultModelSelection) {
        store.setModelSelection(draftId, defaultModelSelection, { replaceOptions: true });
      }
    },
    [environments, projectGroupingSettings],
  );
}
