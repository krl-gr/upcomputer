import Svg, { G } from "react-native-svg";

import { EyeAccessories, FaceAccessories, Headwear } from "./Accessories";
import type { BotAccessory } from "./catalog";

// The desktop frames each accessory to its drawn bounds at runtime (`BotAccessoryIcon`);
// react-native-svg can't measure, so these are those frames: x, y, side.
const FRAMES: {
  readonly [Key in Exclude<BotAccessory, "none">]: readonly [number, number, number];
} = {
  bowtie: [42.6, 78.7, 42.8],
  gentleman: [32, 43.3, 64],
  detective: [20.7, 12.4, 104.6],
  chef: [29.9, -0.3, 69.3],
  builder: [21, -13.5, 86],
  artist: [15.2, 5.4, 112.6],
  graduate: [17, -9.5, 94],
  cowboy: [19.7, -11.1, 89.5],
  wizard: [19, -17.9, 90],
  professor: [32.5, 56, 64],
  headphones: [18, 7, 92],
  crown: [23, -14, 82],
  pirate: [17.9, 3.2, 92.9],
  firefighter: [20, -14.5, 88],
  police: [20, -11, 88],
  nurse: [27, -7.5, 74],
  scientist: [26, 41.5, 94],
  pilot: [28, 4.5, 72],
  santa: [28, -15.1, 84],
  winter: [21.5, 37, 85],
  summer: [17, 2, 94],
  photographer: [30, 67.5, 68],
  bunny: [28.5, -7.9, 71],
};

const ICON_HAT_Y: Partial<Record<BotAccessory, number>> = { gentleman: 78, winter: 80 };

/** One accessory without a body, as in the desktop's Accessories picker. */
export function BotAccessoryIcon(props: {
  readonly accessory: Exclude<BotAccessory, "none">;
  readonly size: number;
}) {
  const [x, y, side] = FRAMES[props.accessory];
  return (
    <Svg
      width={props.size}
      height={props.size}
      viewBox={`${x} ${y} ${side} ${side}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G>
        <Headwear
          accessory={props.accessory}
          hat={{ x: 64, y: ICON_HAT_Y[props.accessory] ?? 43, tilt: 0 }}
        />
        <EyeAccessories accessory={props.accessory} />
        <FaceAccessories accessory={props.accessory} />
      </G>
    </Svg>
  );
}
