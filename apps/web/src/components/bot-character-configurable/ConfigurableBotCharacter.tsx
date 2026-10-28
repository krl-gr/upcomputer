/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-raw-colors -- SVG artwork uses colocated CSS and fixed illustration colors independent of UI tokens. */
import { useId, useLayoutEffect, useRef } from "react";
import { EyeAccessories, FaceAccessories, Headwear } from "./Accessories";
import { BotStatusProps, botStatusDetail, usePausedWhenHidden } from "./BotStatusProps";
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
  const root = usePausedWhenHidden();
  const shape = botShapes.find((entry) => entry.id === appearance.shape) ?? botShapes[4];
  const color = botColors.find((entry) => entry.id === appearance.color) ?? botColors[4];
  const stateLabel = botStates.find((entry) => entry.id === state)?.label ?? botStates[0].label;
  const pixels = Number.isFinite(size) ? Math.max(24, size) : 64;
  const compact = botStatusDetail(pixels) === "compact";
  // The cage is the whole limited picture, so a small avatar frames the cage, not the body.
  const framesBody = compact && state !== "limited";

  return (
    <svg
      ref={root}
      className={`cbc${className ? ` ${className}` : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={framesBody ? `0 ${shape.centerY - 64} 128 128` : "0 0 128 128"}
      width={pixels}
      height={pixels}
      data-state={state}
      data-detail={botStatusDetail(pixels)}
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
        <BotStatusProps />
      </g>
    </svg>
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
