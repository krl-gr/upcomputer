/* oxlint-disable shadcn/no-unknown-classes -- SVG artwork uses the colocated BotCharacter.css, not Tailwind utilities. */
import { useEffect, useId, useRef } from "react";

import { observeCharacterMotion } from "./characterMotion";
import "./BotCharacter.css";

export type BotCharacterState = "idle" | "working" | "waiting" | "limited" | "attention";

type BotCharacterProps = {
  state: BotCharacterState;
  size: number;
  palette: "blue" | "mint" | "peach" | "lavender" | "rose" | "amber";
  className?: string;
  decorative?: boolean;
  label?: string;
};

const stateLabels: Record<BotCharacterState, string> = {
  idle: "Bot: ready",
  working: "Bot: working",
  waiting: "Bot: waiting for an external dependency",
  limited: "Bot: provider limit reached",
  attention: "Bot: waiting for you",
};

const silhouette =
  "M49 151C30 150 21 134 27 117C14 101 22 77 44 70C47 43 72 28 94 35C107 38 111 46 116 47C135 40 153 51 158 68C179 73 185 96 175 112C187 133 173 155 153 156C142 174 117 176 100 165C81 177 57 170 49 151Z";

/** Palette identifies the bot. State must also have a text status in the surrounding UI. */
export function BotCharacter({
  state,
  size,
  palette,
  className,
  decorative = false,
  label,
}: BotCharacterProps) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const body = `${id}-body`;
  const sheen = `${id}-sheen`;
  const blush = `${id}-blush`;
  const pearl = `${id}-pearl`;
  const glass = `${id}-glass`;
  const metal = `${id}-metal`;

  useEffect(() => {
    if (ref.current) return observeCharacterMotion(ref.current);
  }, []);

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={size <= 32 ? "16 25 168 156" : "0 0 200 200"}
      className={className ? `bot-character ${className}` : "bot-character"}
      data-state={state}
      data-palette={palette}
      data-detail={size <= 32 ? "compact" : size < 80 ? "small" : "full"}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label || stateLabels[state]}
      focusable="false"
    >
      <defs>
        <linearGradient id={body} x1=".2" y1="0" x2=".75" y2="1">
          <stop stopColor="var(--bot-light)" />
          <stop offset=".46" stopColor="var(--bot-mid)" />
          <stop offset="1" stopColor="var(--bot-deep)" />
        </linearGradient>
        <radialGradient id={sheen} cx=".31" cy=".14" r=".82">
          <stop stopColor="var(--bot-white)" stopOpacity=".78" />
          <stop offset=".53" stopColor="var(--bot-white)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--bot-ink)" stopOpacity=".12" />
        </radialGradient>
        <radialGradient id={blush} cx=".85" cy=".93" r=".8">
          <stop stopColor="var(--bot-accent)" stopOpacity=".9" />
          <stop offset="1" stopColor="var(--bot-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={pearl} x2=".6" y2="1">
          <stop stopColor="var(--bot-white)" />
          <stop offset="1" stopColor="var(--bot-pearl)" />
        </linearGradient>
        <linearGradient id={metal} x2=".85" y2="1">
          <stop stopColor="var(--bot-metal-light)" />
          <stop offset="1" stopColor="var(--bot-metal-deep)" />
        </linearGradient>
        <linearGradient id={glass} x2="1" y2=".7">
          <stop stopColor="var(--bot-glass)" stopOpacity=".24" />
          <stop offset=".4" stopColor="var(--bot-white)" stopOpacity=".02" />
          <stop offset="1" stopColor="var(--bot-glass)" stopOpacity=".15" />
        </linearGradient>
      </defs>

      <ellipse className="bot-character__shadow" cx="101" cy="177" rx="57" ry="6" />
      <g className="bot-character__pose">
        <g className="bot-character__breath">
          <path d={silhouette} fill={`url(#${body})`} />
          <path d={silhouette} fill={`url(#${blush})`} />
          <path d={silhouette} fill={`url(#${sheen})`} />
          <path
            d={silhouette}
            fill="none"
            stroke="var(--bot-white)"
            strokeOpacity=".35"
            strokeWidth="1.2"
          />
          <path
            className="bot-character__highlight"
            d="M53 68C59 49 76 42 89 46"
            fill="none"
            stroke="var(--bot-white)"
            strokeOpacity=".52"
            strokeWidth="3.5"
            strokeLinecap="round"
          />

          <g className="bot-character__face">
            <g className="bot-character__blink">
              <ellipse cx="79" cy="104" rx="17" ry="23" fill="var(--bot-ink)" opacity=".12" />
              <ellipse cx="120" cy="106" rx="17" ry="23" fill="var(--bot-ink)" opacity=".12" />
              <ellipse cx="79" cy="101" rx="16" ry="22" fill={`url(#${pearl})`} />
              <ellipse cx="120" cy="103" rx="16" ry="22" fill={`url(#${pearl})`} />
              <g className="bot-character__gaze">
                <g fill="var(--bot-ink)">
                  <ellipse cx="81" cy="104" rx="8.7" ry="13" />
                  <ellipse cx="122" cy="106" rx="8.7" ry="13" />
                </g>
                <g fill="var(--bot-white)">
                  <ellipse cx="78" cy="99" rx="3" ry="4" opacity=".9" />
                  <ellipse cx="119" cy="101" rx="3" ry="4" opacity=".9" />
                  <circle cx="84" cy="110" r="1.5" opacity=".35" />
                  <circle cx="125" cy="112" r="1.5" opacity=".35" />
                </g>
              </g>
            </g>
            <path
              className="bot-character__smile"
              d="M94 132Q100 137 106 132"
              fill="none"
              stroke="var(--bot-ink)"
              strokeOpacity=".65"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          </g>
        </g>
        <g className="bot-character__hand bot-character__hand--left">
          <g className="bot-character__tap bot-character__tap--left">
            <ellipse cx="45" cy="141" rx="14" ry="17" fill={`url(#${body})`} />
            <ellipse cx="45" cy="141" rx="14" ry="17" fill={`url(#${sheen})`} />
          </g>
        </g>
        <g className="bot-character__hand bot-character__hand--right">
          <g className="bot-character__wave">
            <g className="bot-character__tap bot-character__tap--right">
              <ellipse cx="155" cy="143" rx="14" ry="17" fill={`url(#${body})`} />
              <ellipse cx="155" cy="143" rx="14" ry="17" fill={`url(#${blush})`} />
              <ellipse cx="155" cy="143" rx="14" ry="17" fill={`url(#${sheen})`} />
            </g>
          </g>
        </g>
      </g>

      <g className="bot-character__prop bot-character__laptop">
        <path d="M44 171H156L147 179H53Z" fill="var(--bot-metal-deep)" />
        <path
          d="M42 139Q41 135 46 135H143Q147 135 148 139L154 171H49Z"
          fill={`url(#${metal})`}
          stroke="var(--bot-metal-edge)"
          strokeWidth="1.5"
        />
        <path d="M47 139H142" stroke="var(--bot-white)" strokeOpacity=".45" strokeLinecap="round" />
        <path
          d="M91 151Q97 146 103 151Q109 156 103 160Q97 165 91 160Q86 156 91 151Z"
          fill="var(--bot-white)"
          opacity=".65"
        />
      </g>
      <g className="bot-character__prop bot-character__hourglass">
        <path
          d="M29 125H57C57 137 52 140 46 145C52 150 57 154 57 166H29C29 154 34 150 40 145C34 140 29 137 29 125Z"
          fill={`url(#${glass})`}
          stroke="var(--bot-metal-edge)"
          strokeWidth="1.7"
        />
        <path d="M33 133H53L43 144Z" fill="var(--bot-sand)" />
        <path d="M32 163L43 152L54 163Z" fill="var(--bot-sand)" />
        <path
          className="bot-character__sand"
          d="M43 143V155"
          stroke="var(--bot-sand)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M28 124H58M28 167H58"
          stroke="var(--bot-metal-deep)"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
      <g className="bot-character__prop bot-character__dome">
        <path
          d="M23 170V99C23 55 55 21 100 21S177 55 177 99V170Q100 188 23 170Z"
          fill={`url(#${glass})`}
          stroke="var(--bot-glass-edge)"
          strokeWidth="2"
        />
        <path
          d="M34 94C34 65 52 39 78 34"
          fill="none"
          stroke="var(--bot-white)"
          strokeOpacity=".68"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M24 166Q100 184 176 166V174Q100 192 24 174Z"
          fill={`url(#${metal})`}
          stroke="var(--bot-glass-edge)"
        />
        <rect
          x="87"
          y="160"
          width="26"
          height="23"
          rx="8"
          fill={`url(#${pearl})`}
          stroke="var(--bot-metal-edge)"
        />
        <path
          d="M97 167V176M103 167V176"
          stroke="var(--bot-metal-deep)"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </g>
      <g
        className="bot-character__prop bot-character__greeting"
        fill="none"
        stroke="var(--bot-signal)"
        strokeWidth="2.8"
        strokeLinecap="round"
      >
        <path d="M171 63L175 56M181 72L189 69" />
      </g>
    </svg>
  );
}
