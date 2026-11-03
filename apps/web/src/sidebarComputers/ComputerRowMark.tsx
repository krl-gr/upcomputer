import type { EnvironmentId } from "@t3tools/contracts";

import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  useEnvironmentIdentities,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useSidebarShowsAllComputers } from "./sidebarComputerSelection";

/**
 * In All computers, a row from another computer than this one carries that
 * computer's small machine icon, as projects on several computers already do.
 */
export function ComputerRowMark(props: { readonly environmentIds: ReadonlyArray<EnvironmentId> }) {
  const showsAll = useSidebarShowsAllComputers();
  const primaryId = usePrimaryEnvironmentId();
  const machines = useEnvironmentMachines();
  const identities = useEnvironmentIdentities();
  if (!showsAll || props.environmentIds.some((id) => id === primaryId)) return null;
  const environmentId = props.environmentIds[0];
  if (environmentId === undefined) return null;
  const name =
    identities.find((identity) => identity.environmentId === environmentId)?.label ??
    "another computer";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`On ${name}`}
            data-computer-row-mark={environmentId}
            className="flex shrink-0 text-sidebar-muted-foreground/80"
          />
        }
      >
        <EnvironmentMachineIcon kind={machines.get(environmentId) ?? "server"} className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">On {name}</TooltipPopup>
    </Tooltip>
  );
}
