import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/**
 * Up.computer: the app icon's arrow button stands in for upstream's T3
 * wordmark. The file and component keep upstream's name so merges stay cheap.
 */
const UPCOMPUTER_MARK_PATH =
  "M12 0a12 12 0 1 0 0 24a12 12 0 1 0 0-24ZM12 5.29L17.31 10.59L15.89 12.01L13 9.12L13 18.7L11 18.7L11 9.12L8.11 12.01L6.69 10.59Z";

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="Up.computer"
      height={props.height}
      width={props.height}
      viewBox="0 0 24 24"
    >
      <ThemedPath
        d={UPCOMPUTER_MARK_PATH}
        fillRule="evenodd"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
