const KEY_ALIASES: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Enter: "Return",
  Esc: "Escape",
};

const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  alt: "alt",
  cmd: "super",
  ctrl: "ctrl",
  shift: "shift",
};

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Computer Use requires a non-empty ${key}.`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Computer Use requires a finite ${key}.`);
  }
  return value;
}

function elementIndex(args: Record<string, unknown>): string {
  const value = requireNumber(args, "elementIndex");
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Computer Use requires a non-negative integer elementIndex.");
  }
  return String(value);
}

/** Map only supported arguments: unknown/legacy fields must never select a fallback target. */
export function normalizeComputerUseBackendArgs(
  backendName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (backendName === "list_apps") return {};
  const app = requireString(args, "app");
  switch (backendName) {
    case "get_app_state":
      // The native backend always returns a screenshot and selects its key window.
      return { app };
    case "click": {
      const hasElement = args.elementIndex !== undefined;
      const hasCoordinates = args.x !== undefined || args.y !== undefined;
      if (hasElement === hasCoordinates) {
        throw new Error("Click requires either elementIndex or both x/y, never both targets.");
      }
      const button = args.button ?? "left";
      if (typeof button !== "string" || !["left", "right", "middle"].includes(button)) {
        throw new Error("Unsupported mouse button.");
      }
      if (args.double !== undefined && typeof args.double !== "boolean") {
        throw new Error("Click double must be a boolean.");
      }
      const method = args.coordinateMethod ?? "app_post";
      if (method !== "app_post" && method !== "sky_click")
        throw new Error("Unsupported coordinate click method.");
      if (hasElement && args.coordinateMethod !== undefined)
        throw new Error("coordinateMethod requires x/y, not elementIndex.");
      if (method === "sky_click" && button !== "left")
        throw new Error("sky_click supports only the left mouse button.");
      return {
        app,
        mouse_button: button,
        click_count: args.double === true ? 2 : 1,
        ...(hasElement
          ? { element_index: elementIndex(args) }
          : {
              x: requireNumber(args, "x"),
              y: requireNumber(args, "y"),
              // Never use auto here: its AX descendant search can press a window's
              // Close button instead of the requested point in a VM/canvas.
              click_method: method,
            }),
      };
    }
    case "type_text":
      if (typeof args.text !== "string" || args.text.length === 0) {
        throw new Error("Type text requires a non-empty string text.");
      }
      return { app, text: args.text };
    case "press_key": {
      const rawKey = requireString(args, "key");
      const key = KEY_ALIASES[rawKey] ?? rawKey;
      const modifiers = args.modifiers ?? [];
      if (
        !Array.isArray(modifiers) ||
        modifiers.some((m) => typeof m !== "string" || !MODIFIER_ALIASES[m])
      ) {
        throw new Error("Unsupported keyboard modifiers.");
      }
      return {
        app,
        key:
          modifiers.length > 0 && !key.includes("+")
            ? [...modifiers.map((m: string) => MODIFIER_ALIASES[m]), key].join("+")
            : key,
      };
    }
    case "perform_secondary_action":
      return { app, element_index: elementIndex(args), action: requireString(args, "action") };
    case "set_value":
      if (typeof args.value !== "string") throw new Error("Set value requires a string value.");
      return { app, element_index: elementIndex(args), value: args.value };
    case "scroll": {
      const direction = requireString(args, "direction");
      if (!["up", "down", "left", "right"].includes(direction))
        throw new Error("Unsupported scroll direction.");
      const pages = args.amount === undefined ? 1 : requireNumber(args, "amount");
      if (pages <= 0) throw new Error("Scroll amount must be positive.");
      return { app, element_index: elementIndex(args), direction, pages };
    }
    case "drag":
      return {
        app,
        from_x: requireNumber(args, "fromX"),
        from_y: requireNumber(args, "fromY"),
        to_x: requireNumber(args, "toX"),
        to_y: requireNumber(args, "toY"),
      };
    default:
      throw new Error(`Unsupported Computer Use backend tool: ${backendName}.`);
  }
}

/** An older/custom backend must not silently ignore our safe coordinate method. */
export function assertCoordinateClickSupported(inputSchema: unknown, method: string): void {
  const schema = inputSchema as { properties?: { click_method?: { enum?: unknown } } } | undefined;
  const methods = schema?.properties?.click_method?.enum;
  if (!Array.isArray(methods) || !methods.includes(method)) {
    throw new Error(
      `Coordinate clicks require a Computer Use backend supporting click_method=${method} (managed version 0.3.5). Update the backend; unsafe auto fallback is disabled.`,
    );
  }
}
