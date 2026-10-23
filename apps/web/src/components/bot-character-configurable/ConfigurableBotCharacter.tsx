/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- SVG artwork uses colocated CSS and fixed illustration colors independent of UI tokens. */
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { EyeAccessories, FaceAccessories, Headwear } from "./Accessories";
import {
  botColors,
  botShapes,
  botStates,
  type BotAccessory,
  type BotAppearance,
  type BotCharacterState,
} from "./catalog";
import "./ConfigurableBotCharacter.css";

export type { BotAppearance, BotCharacterState } from "./catalog";
export { botAppearanceCatalog } from "./catalog";

export interface ConfigurableBotCharacterProps {
  state: BotCharacterState;
  size: number;
  appearance: BotAppearance;
  className?: string;
  decorative?: boolean;
  label?: string;
}

export function ConfigurableBotCharacter({
  state,
  size,
  appearance,
  className,
  decorative = false,
  label,
}: ConfigurableBotCharacterProps) {
  const id = `cbc-${useId().replace(/:/g, "")}`;
  const root = useRef<SVGSVGElement>(null);
  const shape = botShapes.find((entry) => entry.id === appearance.shape) ?? botShapes[4];
  const color = botColors.find((entry) => entry.id === appearance.color) ?? botColors[4];
  const stateLabel = botStates.find((entry) => entry.id === state)?.label ?? botStates[0].label;
  const pixels = Number.isFinite(size) ? Math.max(24, size) : 64;
  const compact = pixels < 40;
  // The cage is the whole limited picture, so a small avatar frames the cage, not the body.
  const framesBody = compact && state !== "limited";

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

  return (
    <svg
      ref={root}
      className={`cbc${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={framesBody ? `0 ${shape.centerY - 64} 128 128` : "0 0 128 128"}
      width={pixels}
      height={pixels}
      data-state={state}
      data-detail={compact ? "compact" : pixels < 96 ? "regular" : "full"}
      data-shape={appearance.shape}
      data-color={appearance.color}
      data-accessory={appearance.accessory}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-labelledby={decorative ? undefined : `${id}-title`}
      focusable="false"
    >
      {!decorative && (
        <title id={`${id}-title`}>{label ? `${label}: ${stateLabel}` : stateLabel}</title>
      )}
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2=".85" y2="1">
          <stop stopColor={color.fill} />
          <stop offset="1" stopColor={color.shade} />
        </linearGradient>
      </defs>
      <g aria-hidden="true">
        <ellipse className="cbc-shadow" cx="64" cy="119" rx="39" ry="3" />
        <g className="cbc-pose">
          <path className="cbc-body" d={shape.path} fill={`url(#${id}-body)`} />
          <g className="cbc-eyes" transform={`rotate(${shape.eyeTilt} 64 72)`}>
            <g className="cbc-blink">
              <rect
                className="cbc-eye cbc-eye-left"
                x="49"
                y="61"
                width="10"
                height="24"
                rx="5"
                fill="#fff"
              />
              <rect
                className="cbc-eye cbc-eye-right"
                x="70"
                y="61"
                width="10"
                height="24"
                rx="5"
                fill="#fff"
              />
            </g>
            <g className="cbc-eyewear">
              <EyeAccessories accessory={appearance.accessory} />
            </g>
          </g>
          <Headwear accessory={appearance.accessory} hat={shape.hat} />
          <g className="cbc-accessory-front">
            <FaceAccessories accessory={appearance.accessory} />
          </g>
        </g>
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
      </g>
    </svg>
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

// Picker icons have no head between a hat and what is worn below it, so these
// hats come down onto it and the icon stays one compact, legible outfit.
const iconHatY: Partial<Record<BotAccessory, number>> = { gentleman: 78, winter: 80 };

/** One accessory without a body, framed to its own bounds. */
export function BotAccessoryIcon({ accessory, size }: { accessory: BotAccessory; size: number }) {
  const root = useRef<SVGSVGElement>(null);
  const art = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    if (!root.current || !art.current?.getBBox) return;
    const box = art.current.getBBox();
    const side = Math.max(box.width, box.height) + 6;
    root.current.setAttribute(
      "viewBox",
      `${box.x + box.width / 2 - side / 2} ${box.y + box.height / 2 - side / 2} ${side} ${side}`,
    );
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The accessory changes the drawn bounds the effect measures.
  }, [accessory]);
  return (
    <svg
      ref={root}
      className="cbc cbc-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 128 128"
      width={size}
      height={size}
      data-detail="full"
      aria-hidden
      focusable="false"
    >
      <g ref={art}>
        <Headwear accessory={accessory} hat={{ x: 64, y: iconHatY[accessory] ?? 43, tilt: 0 }} />
        <EyeAccessories accessory={accessory} />
        <FaceAccessories accessory={accessory} />
      </g>
    </svg>
  );
}
