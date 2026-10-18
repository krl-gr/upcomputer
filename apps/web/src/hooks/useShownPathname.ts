import { useRouterState } from "@tanstack/react-router";

/**
 * The path of the page the outlets show. `useLocation` moves to a new path at
 * once, while a route whose lazy chunk is still loading leaves the previous
 * page in the outlet until its match commits. Undefined before the first load.
 */
export function useShownPathname(): string | undefined {
  return useRouterState({ select: (state) => state.matches.at(-1)?.pathname });
}
