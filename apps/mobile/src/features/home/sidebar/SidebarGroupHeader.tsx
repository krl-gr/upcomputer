import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";

export interface SidebarGroupAction {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * A desktop sidebar group's header as an accordion: its name, the pick a closed group still
 * applies ("Projects · Acme"), the chevron, and its button, always shown at finger size.
 */
export function SidebarGroupHeader(props: {
  readonly title: string;
  readonly open: boolean;
  readonly pick?: string | null;
  readonly action?: SidebarGroupAction;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const title = !props.open && props.pick ? `${props.title} · ${props.pick}` : props.title;
  return (
    <View className="min-h-[52px] flex-row items-center gap-2 pl-5 pr-3 pt-2">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        accessibilityLabel={title}
        accessibilityHint={props.open ? gt("Hides the group") : gt("Shows the group")}
        onPress={props.onToggle}
        hitSlop={8}
        className="min-w-0 flex-1 flex-row items-center gap-1.5 py-2 active:opacity-60"
      >
        <Text
          className="shrink text-base font-t3-medium text-foreground-tertiary"
          numberOfLines={1}
        >
          {title}
        </Text>
        <SymbolView
          name={props.open ? "chevron.down" : "chevron.right"}
          size={12}
          weight="semibold"
          tintColorClassName="accent-icon-muted"
        />
      </Pressable>
      {props.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.action.label}
          onPress={props.action.onPress}
          hitSlop={6}
          className="size-10 items-center justify-center rounded-full bg-subtle active:opacity-60"
        >
          <SymbolView
            name={props.action.icon}
            size={17}
            weight="medium"
            tintColorClassName="accent-icon"
          />
        </Pressable>
      ) : null}
    </View>
  );
}
