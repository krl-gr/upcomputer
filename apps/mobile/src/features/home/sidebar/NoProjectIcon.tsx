import { View } from "react-native";

import { useControlTheme } from "../../../components/ui/useControlTheme";

/** The desktop's "No project" icon: a rounded square in its gray project colour at 14%. */
export function NoProjectIcon(props: { readonly size: number }) {
  const { colorScheme } = useControlTheme();
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.size / 4,
        backgroundColor:
          colorScheme === "dark" ? "rgba(156, 163, 175, 0.14)" : "rgba(75, 85, 99, 0.14)",
      }}
    />
  );
}
