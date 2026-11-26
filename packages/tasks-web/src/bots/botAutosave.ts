import { createAutosave } from "@t3tools/tasks-client/bots/botAutosave";
import { useEffect, useState } from "react";

export function useAutosave<T>(value: T | null, write: (value: T) => Promise<void>) {
  const [autosave] = useState(() => createAutosave(value, write));
  // Runs before the caller's scheduling effects, so a scheduled save sees this render's form.
  useEffect(() => autosave.update(value, write));
  useEffect(
    () => () => {
      void autosave.flush();
    },
    [autosave],
  );
  return autosave;
}
