import { defaultBotAppearance, type BotAppearance } from "@t3tools/tasks-contracts/v1";
import { useId } from "react";
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop, ClipPath } from "react-native-svg";

import { useControlTheme } from "../../../components/ui/useControlTheme";
import { EyeAccessories, FaceAccessories, Headwear } from "./Accessories";
import { BotStatusProp } from "./BotStatusProps";
import { botColors, botShapes, type BotCharacterState } from "./catalog";

/**
 * How the desktop's character settles into each state (ConfigurableBotCharacter.css): the body's
 * pose and the eyes' move, as SVG transforms about the same origins.
 */
const POSES: {
  readonly [State in BotCharacterState]: { readonly body?: string; readonly eyes?: string };
} = {
  idle: {},
  working: { body: "translate(0 -2) rotate(-2 64 106)", eyes: "translate(0 7.5)" },
  waiting: { body: "translate(-7 0)", eyes: "translate(3 -2)" },
  attention: { body: "translate(-6 -2)", eyes: "rotate(-14 64 73)" },
  done: { body: "translate(-6 -2)", eyes: "rotate(-14 64 73)" },
  failed: { body: "translate(-6 -2)", eyes: "rotate(-14 64 73)" },
  limited: {
    body: "translate(0 -7) translate(64 106) scale(0.85) translate(-64 -106)",
    eyes: "translate(0 2)",
  },
};

/**
 * The desktop's bot character at list size: its shape, color and accessory, framed on the body
 * like the desktop's small avatars. A state shows as the desktop's does once it has settled: the
 * pose, and the laptop, clock, sign or cage beside the bot. A bot that never chose a look draws
 * its id's.
 */
export function BotCharacter(props: {
  readonly id: string;
  readonly appearance: BotAppearance | null | undefined;
  readonly size: number;
  readonly state?: BotCharacterState;
}) {
  const key = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradient = `bot-${key}`;
  const lid = `bot-lid-${key}`;
  const { colorScheme } = useControlTheme();
  const state = props.state ?? "idle";
  const pose = POSES[state];
  const look = props.appearance ?? defaultBotAppearance(props.id);
  const shape = botShapes.find((entry) => entry.id === look.shape) ?? botShapes[4];
  const color = botColors.find((entry) => entry.id === look.color) ?? botColors[4];
  // The desktop draws the character a fifth larger than a portrait to look the same size.
  const size = Math.round(props.size * 1.2);
  // The cage is the whole limited picture, so a small avatar frames the cage, not the body.
  const viewBox = state === "limited" ? "0 0 128 128" : `0 ${shape.centerY - 64} 128 128`;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id={gradient} x1="0" y1="0" x2=".85" y2="1">
          <Stop offset="0" stopColor={color.fill} />
          <Stop offset="1" stopColor={color.shade} />
        </LinearGradient>
        {/* Tired, half-shut lids while limited; otherwise the eyes are open. */}
        <ClipPath id={lid}>
          <Rect x="40" y="73" width="50" height="80" />
        </ClipPath>
      </Defs>
      <G transform={pose.body}>
        <Path d={shape.path} fill={`url(#${gradient})`} />
        <G transform={pose.eyes}>
          <G clipPath={state === "limited" ? `url(#${lid})` : undefined}>
            <Rect x="49" y="61" width="11" height="24" rx="5" fill="#fff" />
            <Rect x="70" y="61" width="11" height="24" rx="5" fill="#fff" />
          </G>
          <EyeAccessories accessory={look.accessory} />
        </G>
        <Headwear accessory={look.accessory} hat={shape.hat} />
        <FaceAccessories accessory={look.accessory} />
      </G>
      <BotStatusProp state={state} hand={color} dark={colorScheme === "dark"} />
    </Svg>
  );
}
