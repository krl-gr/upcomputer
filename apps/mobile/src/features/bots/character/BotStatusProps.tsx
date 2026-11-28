import type { ReactNode } from "react";
import { Circle, G, Path, Rect } from "react-native-svg";

import type { BotCharacterState } from "./catalog";

// The desktop's status props (apps/web/src/components/bot-character-configurable/BotStatusProps.tsx)
// at rest, in the 128 box. The phone draws a list-size character, so the laptop's typing line,
// which the desktop leaves out at that size, is left out here too.

const LIGHT = { device: "#9dafc5", deviceEdge: "#7d93af", rim: "#8fa7c4" };
const DARK = { device: "#849ab5", deviceEdge: "#5d7798", rim: "#94b3d7" };

/** The desktop's `.cbc-rimmed`: a light ring painted under the fill, apart from the body. */
function Rimmed(props: { readonly children: (rim: boolean) => ReactNode }) {
  return (
    <>
      {props.children(true)}
      {props.children(false)}
    </>
  );
}

const rim = (on: boolean) =>
  on ? { stroke: "#fff", strokeOpacity: 0.9, strokeWidth: 3 } : { stroke: "none" };

function StatusSign(props: {
  readonly color: string;
  readonly hand: { readonly fill: string; readonly shade: string };
  readonly children: ReactNode;
}) {
  return (
    <G transform="rotate(8 100 70)">
      <Rect x="97.5" y="74" width="5.5" height="34" rx="2.75" fill="#9a6a3a" />
      <Rimmed>
        {(on) => (
          <Rect x="80" y="45" width="41" height="33" rx="7.5" fill={props.color} {...rim(on)} />
        )}
      </Rimmed>
      {props.children}
      <Circle
        cx="100.2"
        cy="93"
        r="6.6"
        fill={props.hand.fill}
        stroke={props.hand.shade}
        strokeWidth="1.2"
      />
    </G>
  );
}

/** The prop that shows the bot's state beside it; idle has none. */
export function BotStatusProp(props: {
  readonly state: BotCharacterState;
  readonly hand: { readonly fill: string; readonly shade: string };
  readonly dark: boolean;
}) {
  const palette = props.dark ? DARK : LIGHT;
  switch (props.state) {
    case "idle":
      return null;
    case "working":
      return (
        <G>
          <Path
            d="M29 91Q29 86 34 86H94Q99 86 99 91L96 115H32Z"
            fill={palette.device}
            stroke="#e1ebf9"
            strokeWidth="1.3"
          />
          <Path d="M24 115H104Q104 122 97 122H31Q24 122 24 115Z" fill={palette.deviceEdge} />
          <Circle cx="64" cy="100" r="3.5" fill="#f4f8ff" />
        </G>
      );
    case "waiting":
      return (
        <G transform="translate(102 59) scale(1.2) translate(-102 -58)">
          <Rimmed>
            {(on) => <Circle cx="102" cy="58" r="18" fill={palette.rim} {...rim(on)} />}
          </Rimmed>
          <Circle cx="102" cy="58" r="13.5" fill="#f8fafc" />
          <Path
            d="M102 49V58L96 64"
            fill="none"
            stroke="#607b9b"
            strokeWidth="3.6"
            strokeLinecap="round"
          />
          <Circle cx="102" cy="58" r="2.2" fill="#607b9b" />
        </G>
      );
    case "attention":
      return (
        <StatusSign color="#f59e0b" hand={props.hand}>
          <Path
            d="M94.5 56.5Q95 51 100.5 51Q106.5 51 106.5 56.3Q106.5 59.8 102.2 61.6Q100.5 62.4 100.5 65"
            fill="none"
            stroke="#fff"
            strokeWidth="5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx="100.5" cy="71.5" r="3.3" fill="#fff" />
        </StatusSign>
      );
    case "done":
      return (
        <StatusSign color="#1fa463" hand={props.hand}>
          <Path
            d="M90.5 62.5L97 69L109.5 55.5"
            fill="none"
            stroke="#fff"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </StatusSign>
      );
    case "failed":
      return (
        <StatusSign color="#e5484d" hand={props.hand}>
          <Path
            d="M93 54.5L107 68.5M107 54.5L93 68.5"
            fill="none"
            stroke="#fff"
            strokeWidth="6"
            strokeLinecap="round"
          />
        </StatusSign>
      );
    case "limited":
      return (
        <G>
          <Path d="M10 112V58C10 0 118 0 118 58V112Z" fill="#ffd54a" fillOpacity={0.08} />
          <Path
            d="M64 12C34.3 12 10 28 10 58V112M64 12C43.65 12 27 28 27 58V112M64 12C53.825 12 45.5 28 45.5 58V112M64 12V112M64 12C74.175 12 82.5 28 82.5 58V112M64 12C84.35 12 101 28 101 58V112M64 12C93.7 12 118 28 118 58V112"
            fill="none"
            stroke="#e0a417"
            strokeWidth="2.6"
          />
          <Path d="M10 58Q64 66 118 58" fill="none" stroke="#e9ad1d" strokeWidth="3.4" />
          <Circle cx="64" cy="8" r="5" fill="none" stroke="#e9ad1d" strokeWidth="3" />
          <Path d="M7 110Q64 121 121 110V116Q64 129 7 116Z" fill="#e9ad1d" />
          <Path
            d="M58 113V109A6 6 0 0 1 70 109V113"
            fill="none"
            stroke="#8a5a00"
            strokeWidth="3.4"
          />
          <Rect
            x="52"
            y="112"
            width="24"
            height="14"
            rx="4"
            fill="#ffd257"
            stroke="#a86f00"
            strokeWidth="1.6"
          />
          <Path d="M64 116.5V120.5" stroke="#7a4f00" strokeWidth="3.4" strokeLinecap="round" />
        </G>
      );
  }
}
