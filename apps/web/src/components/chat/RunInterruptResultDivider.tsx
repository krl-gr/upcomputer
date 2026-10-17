import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { CheckIcon, CircleStopIcon, XIcon, type LucideIcon } from "lucide-react";

import { environmentThreadDetails } from "../../state/threads";
import { TimelineSystemDivider } from "./TimelineSystemDivider";
import {
  runInterruptResultPresentation,
  type RunInterruptResultKind,
} from "./RunInterruptResultDivider.logic";

const ICONS: Record<RunInterruptResultKind, LucideIcon> = {
  interrupted: XIcon,
  finished: CheckIcon,
  stopped: CircleStopIcon,
  failed: XIcon,
};

export function RunInterruptResultDivider(props: {
  readonly item: Extract<OrchestrationV2TurnItem, { readonly type: "run_interrupt_result" }>;
  readonly environmentId: EnvironmentId;
}) {
  const { item } = props;
  // The timeline hides the request row, but the thread keeps it next to its result.
  const requestMessage = useAtomValue(
    environmentThreadDetails.threadAtom(scopeThreadRef(props.environmentId, item.threadId)),
    (thread) => {
      if (item.runId === null) return null;
      for (const candidate of thread?.projection.turnItems ?? []) {
        if (candidate.type === "run_interrupt_request" && candidate.runId === item.runId) {
          return candidate.message;
        }
      }
      return null;
    },
  );
  return (
    <RunInterruptResultDividerView resultMessage={item.message} requestMessage={requestMessage} />
  );
}

function RunInterruptResultDividerView(props: {
  readonly resultMessage: string;
  readonly requestMessage: string | null;
}) {
  const presentation = runInterruptResultPresentation(props);
  return (
    <TimelineSystemDivider
      label={presentation.label}
      detail={presentation.detail}
      tone={presentation.tone}
      icon={ICONS[presentation.kind]}
    />
  );
}
