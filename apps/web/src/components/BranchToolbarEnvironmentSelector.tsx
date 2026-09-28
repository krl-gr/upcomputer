import type { EnvironmentId } from "@upcomputer/contracts";
import { memo, useMemo } from "react";

import { cn } from "../lib/utils";
import type { EnvironmentOption } from "./BranchToolbar.logic";
import { CONTEXT_BAR_TEXT_TRIGGER_CLASS } from "./BranchToolbar.styles";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  // Absent when there is only one environment to show: the indicator still
  // renders (as a static label) so remote projects are always identifiable.
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const environmentItems = useMemo(
    () =>
      availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    [availableEnvironments],
  );

  if (envLocked || onEnvironmentChange === undefined) {
    return (
      <span className={cn(CONTEXT_BAR_TEXT_TRIGGER_CLASS, "inline-flex")}>
        {activeEnvironment?.label ?? "Run on"}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={environmentId}
      onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
      items={environmentItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className={cn(CONTEXT_BAR_TEXT_TRIGGER_CLASS, "[&_[data-slot=select-icon]]:hidden")}
        aria-label="Run on"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} side="top">
        <SelectGroup>
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              {env.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
