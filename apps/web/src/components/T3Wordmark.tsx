import type { SVGProps } from "react";

/**
 * Up.computer: the app icon stands in for upstream's T3 wordmark. The file and
 * component keep upstream's name so merges stay cheap. The build swaps the
 * icon per channel (dev, nightly, production).
 */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
      <image href="/apple-touch-icon.png" width="180" height="180" />
    </svg>
  );
}
