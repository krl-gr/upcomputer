import type { BotForm } from "@t3tools/tasks-client/bots/botForm";
import { useCallback, useSyncExternalStore } from "react";

/**
 * What the user changed in an open bot settings sheet, by sheet. Kept outside the sheet because
 * its Model row opens the model picker as a sheet of its own, which edits the same form.
 * A field left out follows the saved bot or the default.
 */
export type BotFormChanges = Partial<Omit<BotForm, "id" | "threadId">>;

const NO_CHANGES: BotFormChanges = {};
const forms = new Map<string, BotFormChanges>();
const listeners = new Set<() => void>();

export function changeBotForm(key: string, patch: BotFormChanges) {
  forms.set(key, { ...forms.get(key), ...patch });
  for (const listener of listeners) listener();
}

export function forgetBotForm(key: string) {
  if (forms.delete(key)) for (const listener of listeners) listener();
}

export function useBotFormChanges(key: string): BotFormChanges {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const read = () => forms.get(key) ?? NO_CHANGES;
  return useSyncExternalStore(subscribe, read, read);
}
