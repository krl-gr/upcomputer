import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

/**
 * A sheet toolbar button as Apple draws it: a 44pt interactive glass capsule with no tint or
 * border of our own, so UIKit's material supplies the edge highlight.
 */
export function GlassCapsule(props: { readonly children: ReactNode; readonly wide?: boolean }) {
  const shape = props.wide
    ? {
        height: 44,
        borderRadius: 22,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingLeft: 14,
        paddingRight: 12,
      }
    : {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      };
  if (Platform.OS === "ios" && isGlassEffectAPIAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={shape}>
        {props.children}
      </GlassView>
    );
  }
  return (
    <View className="bg-subtle" style={shape}>
      {props.children}
    </View>
  );
}
