import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EnvironmentId,
  ProjectId,
  type ModelSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import { useGT } from "gt-react-native";

import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { resolveProviderOptionDescriptors } from "../../lib/providerOptions";
import { useEnvironmentServerConfig } from "../../state/entities";
import {
  rememberModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import { ThreadSettingsPickerScreen } from "../threads/ThreadSettingsSheet";
import { changeBotForm, useBotFormChanges } from "./botFormStore";

export type BotModelParams = {
  /** The bot settings sheet whose form this picker edits. */
  readonly formKey: string;
  readonly environmentId: string;
  readonly projectId?: string;
  /** The form's values when the picker opened. */
  readonly selection?: ModelSelection;
  readonly runtimeMode: RuntimeMode;
};

/** The bot's Model row: the thread model picker, editing the open bot settings sheet. */
export function BotModelScreen({ route }: StaticScreenProps<BotModelParams>) {
  const gt = useGT();
  const navigation = useNavigation();
  const { formKey } = route.params;
  const changes = useBotFormChanges(formKey);
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId =
    changes.projectId ??
    (route.params.projectId === undefined ? null : ProjectId.make(route.params.projectId));
  const selection = changes.selection ?? route.params.selection ?? null;
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const modelOptions = buildModelOptions(serverConfig, selection, undefined, projectId);
  const current = selection
    ? modelOptions.find(
        (option) =>
          option.selection.instanceId === selection.instanceId &&
          option.selection.model === selection.model,
      )
    : undefined;

  return (
    <ThreadSettingsPickerScreen
      title={gt("Model")}
      environmentId={environmentId}
      projectId={projectId}
      cwd={null}
      {...(selection ? { providerInstanceId: selection.instanceId } : {})}
      providerGroups={groupByProvider(modelOptions)}
      selectedModel={selection}
      // Bots take no prompt-controlled traits, as on the desktop.
      prompt=""
      onPromptChange={() => {}}
      onSelectModel={(option) =>
        changeBotForm(formKey, { selection: withRememberedModelOptions(option.selection) })
      }
      restoreSelection={withRememberedModelOptions}
      optionDescriptors={resolveProviderOptionDescriptors({
        capabilities: current?.capabilities,
        selections: selection?.options,
      })}
      onUpdateOptionSelections={(options) => {
        if (!selection) return;
        rememberModelOptions(selection.instanceId, selection.model, options ?? []);
        changeBotForm(formKey, { selection: { ...selection, options } });
      }}
      runtimeMode={changes.runtimeMode ?? route.params.runtimeMode}
      onUpdateRuntimeMode={(runtimeMode) => changeBotForm(formKey, { runtimeMode })}
      onClose={() => navigation.goBack()}
    />
  );
}
