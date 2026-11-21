import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";

/** Feature surfaces the person turned off in Settings, per device. Ids, so never rename one. */
const HIDDEN_RIGHT_PANEL_SURFACES_KEY = "upcomputer:right-panel:hidden-surfaces";
const HiddenSurfaceIds = Schema.Array(Schema.String);
const NONE_HIDDEN: readonly string[] = [];

/**
 * Which feature surfaces the right panel's launcher and "+" menu leave out,
 * and a way to show or hide one. A tab that is already open stays open.
 */
export function useHiddenRightPanelSurfaces() {
  const [hidden, setHidden] = useLocalStorage(
    HIDDEN_RIGHT_PANEL_SURFACES_KEY,
    NONE_HIDDEN,
    HiddenSurfaceIds,
  );
  const setShown = (surfaceId: string, shown: boolean) =>
    setHidden((current) => {
      const rest = current.filter((id) => id !== surfaceId);
      return shown ? rest : [...rest, surfaceId];
    });
  return { hidden, setShown } as const;
}
