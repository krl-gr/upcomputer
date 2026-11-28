import { use } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";

import { HeaderItemsWidthContext } from "../../native/header-items-width";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { AppText as Text } from "./AppText";
import type { AppBarTitlePill } from "./AppBar.types";

// A glass bar button's height and width; the bar counts this item as one button.
const BAR_BUTTON_SIZE = 44;
const MIN_WIDTH = 88;

/**
 * The content of a leading bar item that UIKit wraps in the bar's shared glass, so it reads as a
 * capsule beside Back. It stays within the room the bar's other items leave, and its label
 * truncates.
 */
export function HeaderTitlePill(props: AppBarTitlePill) {
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = useNativeColumnLayoutMetrics()?.width ?? windowWidth;
  const itemsWidth = use(HeaderItemsWidthContext) ?? 160;
  const maxWidth = Math.max(MIN_WIDTH, columnWidth - itemsWidth + BAR_BUTTON_SIZE - 8);
  const content = (
    <>
      <View className="shrink-0">{props.icon}</View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        className="shrink text-[17px] font-t3-medium text-header-foreground"
      >
        {props.label}
      </Text>
    </>
  );
  const style = {
    height: BAR_BUTTON_SIZE,
    maxWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    paddingRight: 16,
  } as const;
  return props.onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      hitSlop={4}
      onPress={props.onPress}
      style={({ pressed }) => [style, pressed ? { opacity: 0.6 } : null]}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityRole="header" accessibilityLabel={props.label} style={style}>
      {content}
    </View>
  );
}
