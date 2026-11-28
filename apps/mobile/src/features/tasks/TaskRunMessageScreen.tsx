import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { TaskAgentRunId } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { PullRequestSheetContent } from "../pull-requests/PullRequestSheetContent";
import { readTasksClient } from "./tasksRpc";

export type TaskRunMessageParams = {
  readonly environmentId: string;
  readonly runId: string;
  /** The run's worker, by name. */
  readonly worker: string;
  /** Whether the run was still working when the sheet opened. */
  readonly active: boolean;
};

/**
 * A message to a worker run, as the agent_run_message tool sends it: an active run gets it in its
 * chat, an ended run continues as a new run in the same chat.
 */
export function TaskRunMessageScreen({ route }: StaticScreenProps<TaskRunMessageParams>) {
  const gt = useGT();
  const navigation = useNavigation();
  const { params } = route;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const send = async () => {
    const message = text.trim();
    if (message === "" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const sent = await readTasksClient(EnvironmentId.make(params.environmentId))
      .agents.messageRun({ runId: TaskAgentRunId.make(params.runId), text: message })
      .then(
        () => true,
        (cause: unknown) => {
          Dialog.alert(
            gt("Couldn't send the message"),
            cause instanceof Error ? cause.message : String(cause),
          );
          return false;
        },
      );
    inFlight.current = false;
    setBusy(false);
    if (sent) navigation.goBack();
  };

  return (
    <PullRequestSheetContent
      busy={busy}
      title={gt("Message worker")}
      subtitle={params.worker}
      footer={
        <Button
          fullWidth
          tone="contrast"
          label={busy ? gt("Sending…") : gt("Send", { $context: "button that sends a message" })}
          loading={busy}
          disabled={text.trim() === ""}
          onPress={() => void send()}
        />
      }
    >
      <TextInput
        autoFocus
        multiline
        editable={!busy}
        accessibilityLabel={gt("Message")}
        placeholder={gt("Message {worker}", { worker: params.worker })}
        placeholderTextColorClassName="accent-foreground-muted"
        maxLength={65536}
        value={text}
        onChangeText={setText}
        className="min-h-36 rounded-[20px] bg-grouped-card p-4 text-base text-foreground"
        style={{ textAlignVertical: "top" }}
      />
      <Text className="text-xs text-foreground-muted">
        {params.active
          ? gt("{worker} gets this in its chat while it works.", { worker: params.worker })
          : gt("The run ended, so this continues it as a new run in the same chat.")}
      </Text>
    </PullRequestSheetContent>
  );
}
