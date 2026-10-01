import type { ComputerUseToolMode } from "@upcomputer/computer-use-contracts/settings";

export const COMPUTER_USE_NAMESPACE = "t3_computer" as const;
export const COMPUTER_USE_TOOL_PREFIX = "computer_" as const;

export interface ComputerUseToolDefinition {
  readonly name: string;
  readonly backendName: string;
  readonly label: string;
  readonly description: string;
  readonly mode: ComputerUseToolMode;
  readonly required: boolean;
  readonly inputSchema: Record<string, unknown>;
}

const emptyObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

const targetProperties = {
  app: {
    type: "string",
    description: "Visible application name or bundle identifier.",
  },
  elementIndex: {
    type: "integer",
    minimum: 0,
    description: "Element index from computer_get_app_state.",
  },
  x: {
    type: "number",
    description:
      "X coordinate in pixels of the latest app screenshot (not screen-global coordinates). Disabled unless coordinate fallback is enabled.",
  },
  y: {
    type: "number",
    description:
      "Y coordinate in pixels of the latest app screenshot (not screen-global coordinates). Disabled unless coordinate fallback is enabled.",
  },
} as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export const COMPUTER_USE_TOOLS = [
  {
    name: "computer_list_apps",
    backendName: "list_apps",
    label: "List desktop apps",
    description: "List currently visible desktop applications and windows.",
    mode: "observe",
    required: true,
    inputSchema: emptyObjectSchema,
  },
  {
    name: "computer_get_app_state",
    backendName: "get_app_state",
    label: "Read desktop app",
    description:
      "Read the state of a desktop application, including visible text and element indexes where available.",
    mode: "observe",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
      },
      ["app"],
    ),
  },
  {
    name: "computer_screenshot",
    backendName: "get_app_state",
    label: "Capture desktop screenshot",
    description: "Capture visual state for a desktop application.",
    mode: "observe",
    required: false,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
      },
      ["app"],
    ),
  },
  {
    name: "computer_click",
    backendName: "click",
    label: "Click desktop",
    description:
      "Click a desktop UI element by element index, or by coordinate when fallback is enabled.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        ...targetProperties,
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
        },
        double: {
          type: "boolean",
        },
        coordinateMethod: {
          type: "string",
          enum: ["app_post", "sky_click"],
          description:
            "For x/y only. Defaults to app_post (direct app events). For macOS VM/canvas windows use sky_click (left single/double click only). Neither mode searches for nearby accessibility buttons. Verify the effect in the next screenshot.",
        },
      },
      ["app"],
    ),
  },
  {
    name: "computer_secondary_action",
    backendName: "perform_secondary_action",
    label: "Open desktop context action",
    description:
      "Invoke an exact secondary accessibility action listed by computer_get_app_state. For a context click use computer_click with button right.",
    mode: "action",
    required: false,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        elementIndex: targetProperties.elementIndex,
        action: {
          type: "string",
          minLength: 1,
          description: "Exact secondary action name from the element.",
        },
      },
      ["app", "elementIndex", "action"],
    ),
  },
  {
    name: "computer_scroll",
    backendName: "scroll",
    label: "Scroll desktop",
    description: "Scroll within a desktop application or element.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        elementIndex: targetProperties.elementIndex,
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
        },
        amount: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Number of pages to scroll; fractional values are supported. Defaults to 1.",
        },
      },
      ["app", "elementIndex", "direction"],
    ),
  },
  {
    name: "computer_drag",
    backendName: "drag",
    label: "Drag desktop",
    description:
      "Drag between screenshot pixel coordinates in an app. Uses app-local events; native window moves or Finder drag-and-drop may not work. Never assume success without checking the result.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        fromX: targetProperties.x,
        fromY: targetProperties.y,
        toX: targetProperties.x,
        toY: targetProperties.y,
      },
      ["app", "fromX", "fromY", "toX", "toY"],
    ),
  },
  {
    name: "computer_type_text",
    backendName: "type_text",
    label: "Type desktop text",
    description: "Type text into the focused desktop element.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        text: {
          type: "string",
          minLength: 1,
        },
      },
      ["app", "text"],
    ),
  },
  {
    name: "computer_press_key",
    backendName: "press_key",
    label: "Press desktop key",
    description: "Press a keyboard key or keyboard shortcut.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        key: {
          type: "string",
          minLength: 1,
        },
        modifiers: {
          type: "array",
          items: {
            type: "string",
            enum: ["cmd", "ctrl", "alt", "shift"],
          },
        },
      },
      ["app", "key"],
    ),
  },
  {
    name: "computer_set_value",
    backendName: "set_value",
    label: "Set desktop value",
    description: "Set the value of a desktop element.",
    mode: "action",
    required: true,
    inputSchema: objectSchema(
      {
        app: targetProperties.app,
        elementIndex: targetProperties.elementIndex,
        value: {
          type: "string",
        },
      },
      ["app", "elementIndex", "value"],
    ),
  },
] as const satisfies ReadonlyArray<ComputerUseToolDefinition>;

export const COMPUTER_USE_TOOL_NAMES = COMPUTER_USE_TOOLS.map((tool) => tool.name);
export const COMPUTER_USE_OBSERVE_TOOL_NAMES = COMPUTER_USE_TOOLS.filter(
  (tool) => tool.mode === "observe",
).map((tool) => tool.name);
export const COMPUTER_USE_ACTION_TOOL_NAMES = COMPUTER_USE_TOOLS.filter(
  (tool) => tool.mode === "action",
).map((tool) => tool.name);

const toolByName = new Map<string, ComputerUseToolDefinition>(
  COMPUTER_USE_TOOLS.map((tool) => [tool.name, tool]),
);

export function getComputerUseToolDefinition(name: string): ComputerUseToolDefinition | undefined {
  return toolByName.get(name);
}

export function isComputerUseToolName(name: string): boolean {
  return toolByName.has(name);
}

export function isComputerUseActionTool(name: string): boolean {
  return getComputerUseToolDefinition(name)?.mode === "action";
}

export function computerUseToolTitle(name: string): string {
  return getComputerUseToolDefinition(name)?.label ?? name;
}

function trimmedString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function sanitizeComputerUseArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...args };
  if ("text" in sanitized) {
    sanitized.text = "[redacted]";
  }
  if ("value" in sanitized) {
    sanitized.value = "[redacted]";
  }
  return sanitized;
}

export function summarizeComputerUseArgs(toolName: string, args: Record<string, unknown>): string {
  const app = trimmedString(args.app);
  const windowId = trimmedString(args.windowId);
  const elementIndex = typeof args.elementIndex === "number" ? `element ${args.elementIndex}` : "";
  const key = trimmedString(args.key);
  if (toolName === "computer_type_text") {
    const length = typeof args.text === "string" ? args.text.length : 0;
    return `type ${length} character${length === 1 ? "" : "s"}`;
  }
  if (toolName === "computer_set_value") {
    const length = typeof args.value === "string" ? args.value.length : 0;
    return `set value (${length} character${length === 1 ? "" : "s"})`;
  }
  if (toolName === "computer_press_key" && key) {
    return key;
  }
  return [app, windowId, elementIndex].filter(Boolean).join(" / ") || toolName;
}
