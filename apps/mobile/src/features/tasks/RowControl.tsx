import type { ReactNode } from "react";
import { Pressable, type PressableProps } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/**
 * A row's small action in iOS's gray capsule style: an SF Symbol, and a label or a leading
 * badge where the desktop's button carries one. Menus wrap it as their trigger.
 */
export function RowControl({
  icon,
  label,
  leading,
  picker,
  tintClassName,
  ...props
}: Omit<PressableProps, "children"> & {
  readonly accessibilityLabel: string;
  readonly icon?: AppSymbolName;
  readonly label?: string;
  readonly leading?: ReactNode;
  /** A chevron after the label, for a control that opens a picker. */
  readonly picker?: boolean;
  readonly tintClassName?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      {...props}
      className={cn(
        "h-8 min-w-8 flex-row items-center justify-center gap-1.5 rounded-full bg-subtle",
        label !== undefined || leading !== undefined ? "px-2.5" : "px-2",
        props.disabled ? "opacity-40" : "active:opacity-60",
      )}
    >
      {leading}
      {icon ? (
        <SymbolView name={icon} size={15} tintColorClassName={tintClassName ?? "accent-icon"} />
      ) : null}
      {label !== undefined ? (
        <Text
          numberOfLines={1}
          className="max-w-[140px] text-sm font-t3-medium tabular-nums text-foreground"
        >
          {label}
        </Text>
      ) : null}
      {picker ? (
        <SymbolView name="chevron.down" size={10} tintColorClassName="accent-icon-muted" />
      ) : null}
    </Pressable>
  );
}
