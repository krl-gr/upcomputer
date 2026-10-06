import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const surface = vi.hoisted(() => ({ composerFooter: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => surface.composerFooter,
}));
vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));

import { ComposerPrimaryActions } from "../components/chat/ComposerPrimaryActions";
import { ComposerBackdropFade } from "./ComposerBackdropFade";
import {
  composerBottomSpaceClass,
  composerCollapsesOnScroll,
  composerLookClass,
  composerWidthStyle,
} from "./composerFooterSurface";
import {
  COMPOSER_BACKDROP_FADE_CLASS,
  COMPOSER_CARD_CLASS,
  V1_COMPOSER_EXTRA_WIDTH,
  composerSendButtonClass,
} from "./composerLookStyles";

type PrimaryActionsProps = ComponentProps<typeof ComposerPrimaryActions>;

function primaryActions(overrides: Partial<PrimaryActionsProps> = {}) {
  const props: PrimaryActionsProps = {
    compact: false,
    pendingAction: null,
    isRunning: false,
    canInterrupt: false,
    showPlanFollowUpPrompt: false,
    promptHasText: false,
    isSendBusy: false,
    sendDisabledReason: null,
    isConnecting: false,
    isEnvironmentUnavailable: false,
    isPreparingWorktree: false,
    hasSendableContent: false,
    onPreviousPendingQuestion: () => {},
    onInterrupt: () => {},
    onImplementPlanInNewThread: () => {},
    ...overrides,
  };
  return firstButton(renderToStaticMarkup(createElement(ComposerPrimaryActions, props)));
}

/** The first button's class, label and disabled state in static markup. */
function firstButton(markup: string) {
  const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
  const attribute = (name: string) =>
    tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
  const className = attribute("class") ?? "";
  return {
    className,
    classes: new Set(className.split(" ")),
    label: attribute("aria-label"),
    disabled: /\sdisabled=""/.test(tag),
  };
}

const STATES = {
  empty: {},
  "has text": { promptHasText: true, hasSendableContent: true },
  queue: {
    isRunning: true,
    canInterrupt: true,
    followUpBehavior: "queue",
    promptHasText: true,
    hasSendableContent: true,
  },
} satisfies Record<string, Partial<PrimaryActionsProps>>;

afterEach(() => {
  surface.composerFooter = "upcomputer";
});

describe("V1's send button", () => {
  it("is V1's grey button when empty, with text and while queueing", () => {
    const empty = primaryActions(STATES.empty);
    expect(empty.className).toBe(composerSendButtonClass(false));
    expect(empty.disabled).toBe(true);
    expect(empty.classes.has("opacity-40")).toBe(true);

    const ready = primaryActions(STATES["has text"]);
    expect(ready.className).toBe(composerSendButtonClass(true));
    expect(ready.label).toBe("Submit message");
    expect(ready.classes.has("opacity-100")).toBe(true);

    const queue = primaryActions(STATES.queue);
    expect(queue.className).toBe(composerSendButtonClass(true));
    expect(queue.label).toBe("Queue message");

    for (const button of [empty, ready, queue]) {
      expect(button.classes.has("bg-message-action")).toBe(false);
    }
  });

  it("keeps the red stop button while a run has nothing to send", () => {
    const stop = primaryActions({ isRunning: true, canInterrupt: true });
    expect(stop.label).toBe("Stop generation");
    expect(stop.classes.has("bg-destructive/90")).toBe(true);
  });

  it("keeps upstream's send button with `upstream`", () => {
    surface.composerFooter = "upstream";
    for (const state of Object.values(STATES)) {
      const button = primaryActions(state);
      expect(button.classes.has("bg-message-action")).toBe(true);
      expect(button.classes.has("bg-[#d4d4d4]")).toBe(false);
    }
  });
});

describe("V1's composer card, fade and full form", () => {
  it("renders the opaque fade behind the composer only with its surface", () => {
    const fade = () => renderToStaticMarkup(createElement(ComposerBackdropFade));
    expect(fade()).toContain('data-composer-backdrop-fade="true"');
    expect(fade()).toContain(COMPOSER_BACKDROP_FADE_CLASS);

    surface.composerFooter = "upstream";
    expect(fade()).toBe("");
  });

  it("gives upstream's composer V1's card only with its surface", () => {
    expect(composerLookClass("card")).toBe(COMPOSER_CARD_CLASS);
    surface.composerFooter = "upstream";
    for (const part of ["shell", "card", "body", "editor", "placeholder"] as const) {
      expect(composerLookClass(part)).toBeUndefined();
    }
  });

  it("never lets a timeline scroll collapse the composer with its surface", () => {
    expect(composerCollapsesOnScroll()).toBe(false);
    surface.composerFooter = "upstream";
    expect(composerCollapsesOnScroll()).toBe(true);
  });
});

describe("V1's composer width and bottom space", () => {
  /** Resolves `var()` the way the cascade does: from the element up through its ancestors. */
  function resolve(value: string, chain: ReadonlyArray<Record<string, string>>): string {
    return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      const index = chain.findIndex((declarations) => name in declarations);
      return resolve(chain[index]![name]!, chain.slice(index + 1));
    });
  }

  it("makes the composer V1's 4rem wider than the messages at every chat width", () => {
    // V1: the composer form at max-w-208 (52rem), the timeline at max-w-3xl (48rem).
    expect(V1_COMPOSER_EXTRA_WIDTH).toBe(`${52 - 48}rem`);
    const overlay = composerWidthStyle("overlay") as Record<string, string>;
    const lane = composerWidthStyle("lane") as Record<string, string>;
    // Upstream's chat width setting: comfortable, wide and full.
    for (const contentWidth of ["46rem", "72rem", "100%"]) {
      const root = { "--chat-content-max-width": contentWidth };
      // Inside the lane, upstream's composer pieces read `--chat-content-max-width`.
      expect(resolve("var(--chat-content-max-width)", [lane, overlay, root])).toBe(
        `calc(${contentWidth} + 4rem)`,
      );
      // The fade sits in the overlay, beside the lane, and reads the composer width.
      expect(COMPOSER_BACKDROP_FADE_CLASS).toContain("max-w-(--chat-composer-max-width)");
      expect(resolve("var(--chat-composer-max-width)", [overlay, root])).toBe(
        `calc(${contentWidth} + 4rem)`,
      );
    }

    surface.composerFooter = "upstream";
    expect(composerWidthStyle("overlay")).toBeUndefined();
    expect(composerWidthStyle("lane")).toBeUndefined();
  });

  it("leaves V1's space under the composer stack", () => {
    // V1's ChatView: pb safe-area + 0.25rem under its context bar, else 0.75rem and 1rem from sm.
    expect(composerBottomSpaceClass(true)).toBe("h-[calc(env(safe-area-inset-bottom)+0.25rem)]");
    expect(composerBottomSpaceClass(false)).toBe(
      "h-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:h-[calc(env(safe-area-inset-bottom)+1rem)]",
    );
    surface.composerFooter = "upstream";
    expect(composerBottomSpaceClass(true)).toBeNull();
  });
});
