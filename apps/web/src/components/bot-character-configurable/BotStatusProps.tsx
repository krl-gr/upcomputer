/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- SVG artwork uses colocated CSS and fixed illustration colors independent of UI tokens. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BotCharacterState } from "./catalog";
import "./BotStatusProps.css";

/** Small drawings show simplified props; the character and a portrait overlay pick it alike. */
export const botStatusDetail = (pixels: number) =>
  pixels < 40 ? "compact" : pixels < 96 ? "regular" : "full";

/** A ref that marks its drawing paused while off screen or the page is hidden, so nothing repaints. */
export function usePausedWhenHidden() {
  const root = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let visible = true;
    const update = () => {
      element.dataset.paused = String(!visible || document.hidden);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            update();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return root;
}

/**
 * True once the state changed after mount. One-shot flourishes (a sign's wave, the clock's
 * ring) play only then, so a list that remounts its rows does not replay them.
 */
export function useStateChanged(state: BotCharacterState) {
  const [first] = useState(state);
  const [changed, setChanged] = useState(false);
  if (!changed && state !== first) setChanged(true);
  return changed;
}

/** The hand that holds a sign takes the body's colors; a portrait overlay has no body. */
export interface BotHandColors {
  readonly fill: string;
  readonly shade: string;
}
const NEUTRAL_HAND: BotHandColors = { fill: "#c9d3df", shade: "#9aa8b8" };

/**
 * The props that show a bot's state, drawn in the 128 box: a laptop, a clock, a sign for
 * needs-you, done and failed, and the provider limit cage. The `.cbc` root's `data-state`
 * shows the one that applies.
 */
export function BotStatusProps({ hand = NEUTRAL_HAND }: { readonly hand?: BotHandColors }) {
  return (
    <>
      <g className="cbc-prop cbc-laptop">
        <path d="M29 91Q29 86 34 86H94Q99 86 99 91L96 115H32Z" className="cbc-device" />
        <path d="M24 115H104Q104 122 97 122H31Q24 122 24 115Z" className="cbc-device-edge" />
        <circle cx="64" cy="100" r="3.5" fill="#f4f8ff" />
        <path
          d="M36 92H49"
          stroke="#d6e8fa"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="cbc-typing cbc-detail"
        />
      </g>
      <g className="cbc-prop cbc-clock">
        <g className="cbc-ring">
          <g transform="translate(102 59) scale(1.2) translate(-102 -58)">
            <circle cx="102" cy="58" r="18" className="cbc-rimmed cbc-clock-rim" />
            <circle cx="102" cy="58" r="13.5" fill="#f8fafc" />
            <path
              d="M102 49V58L96 64"
              fill="none"
              stroke="#607b9b"
              strokeWidth="3.6"
              strokeLinecap="round"
            />
            <circle cx="102" cy="58" r="2.2" fill="#607b9b" />
          </g>
        </g>
      </g>
      <StatusSign name="attention" color="#f59e0b" hand={hand}>
        <path
          d="M94.5 56.5Q95 51 100.5 51Q106.5 51 106.5 56.3Q106.5 59.8 102.2 61.6Q100.5 62.4 100.5 65"
          fill="none"
          stroke="#fff"
          strokeWidth="5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="100.5" cy="71.5" r="3.3" fill="#fff" />
      </StatusSign>
      <StatusSign name="done" color="#1fa463" hand={hand}>
        <path
          d="M90.5 62.5L97 69L109.5 55.5"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </StatusSign>
      <StatusSign name="failed" color="#e5484d" hand={hand}>
        <path
          d="M93 54.5L107 68.5M107 54.5L93 68.5"
          fill="none"
          stroke="#fff"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </StatusSign>
      <g className="cbc-prop cbc-dome">
        <path d="M10 112V58C10 0 118 0 118 58V112Z" fill="#ffd54a" fillOpacity=".08" />
        <path
          d="M64 12C34.3 12 10 28 10 58V112M64 12C43.65 12 27 28 27 58V112M64 12C53.825 12 45.5 28 45.5 58V112M64 12V112M64 12C74.175 12 82.5 28 82.5 58V112M64 12C84.35 12 101 28 101 58V112M64 12C93.7 12 118 28 118 58V112"
          fill="none"
          stroke="#e0a417"
          strokeWidth="2.6"
          className="cbc-cage-bars"
        />
        <path d="M10 58Q64 66 118 58" fill="none" stroke="#e9ad1d" strokeWidth="3.4" />
        <circle cx="64" cy="8" r="5" fill="none" stroke="#e9ad1d" strokeWidth="3" />
        <path d="M7 110Q64 121 121 110V116Q64 129 7 116Z" className="cbc-dome-base" />
        <g className="cbc-lock">
          <path
            d="M58 113V109A6 6 0 0 1 70 109V113"
            fill="none"
            stroke="#8a5a00"
            strokeWidth="3.4"
          />
          <rect
            x="52"
            y="112"
            width="24"
            height="14"
            rx="4"
            fill="#ffd257"
            stroke="#a86f00"
            strokeWidth="1.6"
          />
          <path d="M64 116.5V120.5" stroke="#7a4f00" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      </g>
    </>
  );
}

/** A sign on a stick in the bot's hand, at eye level beside the body; every sign shares the spot. */
function StatusSign({
  name,
  color,
  hand,
  children,
}: {
  name: string;
  color: string;
  hand: BotHandColors;
  children: ReactNode;
}) {
  return (
    <g className={`cbc-prop cbc-sign cbc-${name}`}>
      <g className="cbc-wave">
        <g transform="rotate(8 100 70)">
          <rect x="97.5" y="74" width="5.5" height="34" rx="2.75" fill="#9a6a3a" />
          <rect x="80" y="45" width="41" height="33" rx="7.5" fill={color} className="cbc-rimmed" />
          {children}
          <circle
            cx="100.2"
            cy="93"
            r="6.6"
            fill={hand.fill}
            stroke={hand.shade}
            strokeWidth="1.2"
          />
        </g>
      </g>
    </g>
  );
}

/** The status props alone, to lay over a picture that fills the same square. */
export function BotStatusOverlay({
  state,
  size,
  className,
}: {
  readonly state: BotCharacterState;
  readonly size: number;
  readonly className?: string;
}) {
  const root = usePausedWhenHidden();
  const changed = useStateChanged(state);
  return (
    <svg
      ref={root}
      className={`cbc${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      data-state={state}
      data-changed={changed ? "" : undefined}
      data-detail={botStatusDetail(size)}
      aria-hidden
      focusable="false"
    >
      <BotStatusProps />
    </svg>
  );
}
