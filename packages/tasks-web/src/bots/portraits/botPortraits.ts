// Adapted from nuphos/nuphos apps/desktop/src/lib/botAvatars.ts and botAvatarMotion.ts
// (Apache-2.0, Copyright 2026 Zeabur Inc.). Changed for Up.computer: hand-written labels,
// and the artwork loads as markup to draw inline instead of as image URLs. See art/NOTICE.
import { useEffect, useSyncExternalStore } from "react";
import { botPortraitIds, type BotPortraitId } from "@t3tools/tasks-contracts/v1";

const LABELS: { readonly [Id in BotPortraitId]: string } = {
  "vermeer-girl": "Girl with a pearl earring",
  leonardo: "Leonardo",
  "mona-lisa": "Mona Lisa",
  venus: "Venus",
  rembrandt: "Rembrandt",
  beethoven: "Beethoven",
  ada: "Ada",
  socrates: "Socrates",
  frida: "Frida",
  "van-gogh": "Van Gogh",
  mozart: "Mozart",
  newton: "Newton",
  shakespeare: "Shakespeare",
  napoleon: "Napoleon",
  cleopatra: "Cleopatra",
  athena: "Athena",
  "the-scream": "The scream",
  "american-gothic": "American Gothic",
  "the-fifer": "The fifer",
  "son-of-man": "Son of man",
  "the-milkmaid": "The milkmaid",
  "lady-with-an-ermine": "Lady with an ermine",
  "girl-with-peaches": "Girl with peaches",
  "the-blue-boy": "The blue boy",
  infanta: "Infanta",
  "the-swing": "The swing",
  "the-astronomer": "The astronomer",
  "the-sleeping-gypsy": "The sleeping gypsy",
};

export const botPortraits = botPortraitIds.map((id) => ({ id, label: LABELS[id] }));

export const botPortraitLabel = (id: BotPortraitId) => LABELS[id];

// Each file is its own lazy chunk, so a sidebar of three bots loads three faces, not all 28.
const files = import.meta.glob<string>("./art/*.svg", { query: "?raw", import: "default" });
const loaders = new Map(
  Object.entries(files).map(([path, load]) => [path.replace(/^.*\/\d+-|\.svg$/g, ""), load]),
);
const markup = new Map<BotPortraitId, string>();
const loading = new Map<BotPortraitId, Promise<string | undefined>>();
const listeners = new Set<() => void>();

/** Loads a portrait's markup once; undefined if it could not load, so a later mount retries. */
export function loadBotPortrait(id: BotPortraitId): Promise<string | undefined> {
  const ready = markup.get(id);
  if (ready !== undefined) return Promise.resolve(ready);
  const pending =
    loading.get(id) ??
    (loaders.get(id)?.() ?? Promise.reject(new Error(`No artwork for ${id}`)))
      .then((svg) => {
        // The title would show as a tooltip and name a decorative picture.
        const inline = svg.replace(/<\?xml[^>]*>|<title>[^<]*<\/title>/g, "");
        markup.set(id, inline);
        for (const listener of listeners) listener();
        return inline;
      })
      .catch(() => undefined)
      .finally(() => loading.delete(id));
  loading.set(id, pending);
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The portrait's SVG markup, or undefined while it loads. */
export function usePortraitMarkup(id: BotPortraitId) {
  const svg = useSyncExternalStore(subscribe, () => markup.get(id));
  useEffect(() => {
    void loadBotPortrait(id);
  }, [id]);
  return svg;
}
