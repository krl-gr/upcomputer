import { defaultBotAppearance, type BotAppearance } from "@t3tools/tasks-contracts/v1";
import { useId } from "react";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { EyeAccessories, FaceAccessories, Headwear } from "./Accessories";
import { botColors, botShapes } from "./catalog";

/**
 * The desktop's bot character at list size, at rest: its shape, color and accessory, framed on
 * the body like the desktop's small avatars. A bot that never chose a look draws its id's.
 */
export function BotCharacter(props: {
  readonly id: string;
  readonly appearance: BotAppearance | null | undefined;
  readonly size: number;
}) {
  const gradient = `bot-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const look = props.appearance ?? defaultBotAppearance(props.id);
  const shape = botShapes.find((entry) => entry.id === look.shape) ?? botShapes[4];
  const color = botColors.find((entry) => entry.id === look.color) ?? botColors[4];
  // The desktop draws the character a fifth larger than a portrait to look the same size.
  const size = Math.round(props.size * 1.2);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 ${shape.centerY - 64} 128 128`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id={gradient} x1="0" y1="0" x2=".85" y2="1">
          <Stop offset="0" stopColor={color.fill} />
          <Stop offset="1" stopColor={color.shade} />
        </LinearGradient>
      </Defs>
      <Path d={shape.path} fill={`url(#${gradient})`} />
      <G>
        <Rect x="49" y="61" width="11" height="24" rx="5" fill="#fff" />
        <Rect x="70" y="61" width="11" height="24" rx="5" fill="#fff" />
        <EyeAccessories accessory={look.accessory} />
      </G>
      <Headwear accessory={look.accessory} hat={shape.hat} />
      <FaceAccessories accessory={look.accessory} />
    </Svg>
  );
}
