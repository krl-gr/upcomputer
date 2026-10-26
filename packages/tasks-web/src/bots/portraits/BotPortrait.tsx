// Adapted from nuphos/nuphos apps/desktop/src/components/agent/BotAvatarImage.tsx
// (Apache-2.0, Copyright 2026 Zeabur Inc.). Changed for Up.computer: the portrait draws
// inline, blinks on a timer, and plays its loop now and then while the bot works instead
// of repeating it. See art/NOTICE.
import { useEffect, useRef } from "react";
import type { BotPortraitId } from "@t3tools/tasks-contracts/v1";
import { useMediaQuery } from "../../../../../apps/web/src/hooks/useMediaQuery.ts";
import { cn } from "../../../../../apps/web/src/lib/utils.ts";
import { usePortraitMarkup } from "./botPortraits.ts";
import "./botPortrait.css";

const BLINK_MS = 180;
const LOOP_MS = 6000;
const between = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * One bot portrait. It blinks every few seconds, now and then twice; a working bot also
 * plays the loop every so often, and pointing at the portrait plays it once. Between
 * motions nothing animates, so a sidebar of bots costs no frames while they rest.
 */
export function BotPortrait({
  portrait,
  working = false,
  size,
  className,
}: {
  readonly portrait: BotPortraitId;
  readonly working?: boolean;
  readonly size: number;
  readonly className?: string;
}) {
  const markup = usePortraitMarkup(portrait);
  const root = useRef<HTMLSpanElement>(null);
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    const element = root.current;
    if (!element || still) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextLoop = working ? Date.now() + between(1000, 4000) : Infinity;
    const play = (motion: "blink" | "loop") => {
      element.dataset.motion = motion;
      timer = setTimeout(
        () => {
          delete element.dataset.motion;
          if (motion === "loop") nextLoop = working ? Date.now() + between(8000, 16000) : Infinity;
          // About one blink in five comes as a quick pair.
          rest(motion === "blink" && Math.random() < 0.2 ? 120 : between(2500, 7000));
        },
        motion === "loop" ? LOOP_MS : BLINK_MS,
      );
    };
    const rest = (delay: number) => {
      timer = setTimeout(() => {
        if (document.hidden || element.dataset.motion) rest(between(2500, 7000));
        else play(Date.now() >= nextLoop ? "loop" : "blink");
      }, delay);
    };
    const point = () => {
      if (element.dataset.motion) return;
      clearTimeout(timer);
      play("loop");
    };
    rest(Math.min(nextLoop - Date.now(), between(800, 5000)));
    element.addEventListener("pointerenter", point);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("pointerenter", point);
      delete element.dataset.motion;
    };
  }, [still, working]);

  return (
    <span
      ref={root}
      aria-hidden
      className={cn("bot-portrait", className)}
      style={{ width: size, height: size }}
      // Artwork bundled with the app, never user content.
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
    />
  );
}
