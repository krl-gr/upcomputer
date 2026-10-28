/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- SVG artwork uses colocated CSS and fixed illustration colors independent of UI tokens. */
import { type ReactNode, useEffect, useRef } from "react";
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
 * The props that show a bot's state, drawn in the 128 box: a laptop, a clock, done and
 * failed badges, attention strokes and the provider limit dome. The `.cbc` root's
 * `data-state` shows the one that applies.
 */
export function BotStatusProps() {
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
      <StatusBadge name="clock">
        <path
          d="M64 93V104L57 111"
          fill="none"
          stroke="#607b9b"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="64" cy="104" r="2.6" fill="#607b9b" />
      </StatusBadge>
      <StatusBadge name="done" rim="#1fa463">
        <path
          d="M55 104.5L61.5 111L73.5 98"
          fill="none"
          stroke="#1fa463"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </StatusBadge>
      <StatusBadge name="failed" rim="#e5484d">
        <path
          d="M57 97L71 111M71 97L57 111"
          fill="none"
          stroke="#e5484d"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </StatusBadge>
      <g className="cbc-prop cbc-attention" fill="none" strokeWidth="4" strokeLinecap="round">
        <path d="M104 43L107 37M111 51L117 47M113 60L120 59" />
      </g>
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

/** Waiting, done and failed share one size and place, so the slot reads the same on every body. */
function StatusBadge({ name, rim, children }: { name: string; rim?: string; children: ReactNode }) {
  return (
    <g className={`cbc-prop cbc-${name}`}>
      <circle cx="64" cy="104" r="22" className="cbc-badge" fill={rim} />
      <circle cx="64" cy="104" r="16.5" fill="#f8fafc" />
      {children}
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
  return (
    <svg
      ref={root}
      className={`cbc${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      data-state={state}
      data-detail={botStatusDetail(size)}
      aria-hidden
      focusable="false"
    >
      <BotStatusProps />
    </svg>
  );
}
