/**
 * What a screen inside a side panel tab does when it navigates. The phone's screens were written
 * as routes, so their Back must close their tab, not pop the chat under the panel.
 */
export interface SidePanelNavigationHandlers {
  /** Back, pop and goBack: the screen is done, so its tab closes. */
  readonly close: () => void;
  /** Anything else leaves the panel first (the sheet closes), then runs on the chat's stack. */
  readonly leave: (then: () => void) => void;
  /** A screen replacing itself, such as Terminal switching shells. True when the tab took it. */
  readonly replace?: (name: string, params: unknown) => boolean;
}

interface NavigationAction {
  readonly type: string;
  readonly payload?: { readonly name?: string; readonly params?: unknown };
}

const BACK_ACTIONS = new Set(["GO_BACK", "POP", "POP_TO_TOP"]);

function isNavigationAction(value: unknown): value is NavigationAction {
  return typeof value === "object" && value !== null && "type" in value;
}

/** The chat route's navigation object as a tab's screen sees it. */
export function sidePanelNavigation<Navigation extends object>(
  navigation: Navigation,
  handlers: SidePanelNavigationHandlers,
): Navigation {
  const forward =
    (name: PropertyKey) =>
    (...args: unknown[]) =>
      handlers.leave(() => {
        const method = Reflect.get(navigation, name) as (...args: unknown[]) => unknown;
        method.apply(navigation, args);
      });
  return new Proxy(navigation, {
    get(target, key, receiver) {
      switch (key) {
        case "goBack":
        case "pop":
        case "popToTop":
          return () => handlers.close();
        case "canGoBack":
          return () => true;
        // The chat route's params and bar belong to the chat.
        case "setParams":
        case "setOptions":
          return () => undefined;
        case "navigate":
        case "push":
        case "popTo":
        case "navigateDeprecated":
          return forward(key);
        case "replace":
          return (name: string, params?: unknown) => {
            if (handlers.replace?.(name, params)) return;
            forward(key)(name, params);
          };
        case "dispatch":
          return (action: unknown) => {
            if (isNavigationAction(action)) {
              if (BACK_ACTIONS.has(action.type)) return handlers.close();
              if (
                action.type === "REPLACE" &&
                action.payload?.name !== undefined &&
                handlers.replace?.(action.payload.name, action.payload.params)
              )
                return;
            }
            forward(key)(action);
          };
        default:
          return Reflect.get(target, key, receiver);
      }
    },
  });
}
