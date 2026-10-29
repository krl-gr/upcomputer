import type { LucideIcon } from "lucide-react";
import { useId } from "react";

// In the icon's 24-unit box: the dot at the top right, and the clearance cut around it.
const DOT = { cx: 19, cy: 5, r: 4.5 } as const;
const DOT_CLEARANCE = 2;
const CUT_RADIUS = DOT.r + DOT_CLEARANCE;
// The whole box less a disc around the dot; as an alpha mask it keeps the icon outside the disc.
const CUTOUT = `M0 0H24V24H0Z M${DOT.cx - CUT_RADIUS} ${DOT.cy} a${CUT_RADIUS} ${CUT_RADIUS} 0 1 0 ${CUT_RADIUS * 2} 0 a${CUT_RADIUS} ${CUT_RADIUS} 0 1 0 ${-CUT_RADIUS * 2} 0Z`;

/**
 * A lucide icon with a status dot drawn in its own SVG, as lucide's BellDot
 * is: the icon's strokes are masked away around the dot, so nothing depends
 * on the colour behind it. `dotClassName` fills the dot; null draws the icon.
 */
export function BadgedIcon(props: {
  readonly icon: LucideIcon;
  readonly dotClassName: string | null;
  readonly className?: string;
}) {
  const maskId = useId();
  const Icon = props.icon;
  if (props.dotClassName === null) return <Icon className={props.className} />;
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={props.className}>
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="24"
        height="24"
        style={{ maskType: "alpha" }}
      >
        <path d={CUTOUT} fillRule="evenodd" fill="currentColor" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <Icon width={24} height={24} />
      </g>
      <circle data-icon-dot="" cx={DOT.cx} cy={DOT.cy} r={DOT.r} className={props.dotClassName} />
    </svg>
  );
}
