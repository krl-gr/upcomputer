import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

import { UP_ICONS, type UpIconData, type UpIconElement, type UpIconName } from "./upIconData";

export type { UpIconName } from "./upIconData";

/** Line width in points at any size, close to the weight of the app's regular text. */
const STROKE_POINTS = 1.5;
const GRID = 16;

interface UpIconProps {
  readonly name: UpIconName;
  readonly size?: number;
  readonly tintColor?: ColorValue;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

function UpIconElementView(props: { readonly element: UpIconElement; readonly color: ColorValue }) {
  const { element, color } = props;
  const paint =
    "fill" in element && element.fill ? { fill: color, stroke: "none" } : { fill: "none" };
  switch (element.kind) {
    case "path":
      return <Path d={element.d} {...paint} />;
    case "circle":
      return <Circle cx={element.cx} cy={element.cy} r={element.r} {...paint} />;
    case "ellipse":
      return <Ellipse cx={element.cx} cy={element.cy} rx={element.rx} ry={element.ry} {...paint} />;
    case "line":
      return <Line x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} />;
    case "rect":
      return (
        <Rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rx={element.rx}
          {...paint}
        />
      );
  }
}

export function UpIconView(props: UpIconProps) {
  const size = props.size ?? 24;
  const color = props.tintColor ?? "black";
  const icon: UpIconData = UP_ICONS[props.name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      style={props.style}
      accessibilityLabel={props.accessibilityLabel}
      accessible={props.accessibilityLabel !== undefined}
      testID={props.testID}
    >
      <G
        stroke={color}
        strokeWidth={(STROKE_POINTS * GRID) / size}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        transform={
          icon.rotate === undefined ? undefined : `rotate(${icon.rotate} ${GRID / 2} ${GRID / 2})`
        }
      >
        {icon.elements.map((element) => (
          <UpIconElementView
            key={Object.values(element).join(" ")}
            element={element}
            color={color}
          />
        ))}
      </G>
    </Svg>
  );
}

/** `SymbolView`'s props an `up.*` symbol name keeps when it draws an `UpIcon`. */
export function upIconProps(props: {
  readonly size?: number;
  readonly tintColor?: ColorValue | null;
  readonly style?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}): Omit<UpIconProps, "name"> {
  return {
    size: props.size,
    tintColor: props.tintColor ?? undefined,
    style: props.style,
    accessibilityLabel: props.accessibilityLabel,
    testID: props.testID,
  };
}

/** An iconmcp outline icon. Tint it like `SymbolView`: `tintColor` or `tintColorClassName`. */
export const UpIcon = withUniwind(UpIconView);
