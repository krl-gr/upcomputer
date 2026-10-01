import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  assertCoordinateClickSupported,
  normalizeComputerUseBackendArgs as normalize,
} from "./ComputerUseBackendArgs.ts";
import { COMPUTER_USE_TOOLS } from "./ComputerUseToolDefinitions.ts";

const app = "com.github.cirruslabs.tart";

test("coordinate click uses exact-point delivery, never AX auto descendant selection", () => {
  NodeAssert.deepEqual(normalize("click", { app, x: 431, y: 299 }), {
    app,
    x: 431,
    y: 299,
    mouse_button: "left",
    click_count: 1,
    click_method: "app_post",
  });
  NodeAssert.equal(
    normalize("click", { app, x: 431, y: 299, click_method: "auto" }).click_method,
    "app_post",
  );
});

test("click maps button, double click and string element identifiers", () => {
  NodeAssert.deepEqual(
    normalize("click", { app, elementIndex: 0, button: "right", double: true }),
    {
      app,
      element_index: "0",
      mouse_button: "right",
      click_count: 2,
    },
  );
});

test("invalid or ambiguous targets cannot reach a fallback click", () => {
  for (const args of [
    {},
    { x: 1 },
    { y: 1 },
    { x: NaN, y: 1 },
    { elementIndex: -1 },
    { elementIndex: 1.5 },
    { elementIndex: 2, x: 1, y: 1 },
  ]) {
    NodeAssert.throws(() => normalize("click", { app, ...args }));
  }
});

test("all app-targeted operations require app, including typing, keys and drag", () => {
  for (const tool of COMPUTER_USE_TOOLS.filter((tool) => tool.name !== "computer_list_apps")) {
    NodeAssert.throws(() => normalize(tool.backendName, {}), /non-empty app/);
    const schema = tool.inputSchema as { required?: string[] };
    NodeAssert.ok(schema.required?.includes("app"), tool.name);
  }
});

test("maps keyboard, scroll, secondary actions and drag to supported backend arguments", () => {
  NodeAssert.deepEqual(normalize("type_text", { app, text: "hello" }), { app, text: "hello" });
  NodeAssert.deepEqual(normalize("press_key", { app, key: "Enter", modifiers: ["cmd", "shift"] }), {
    app,
    key: "super+shift+Return",
  });
  NodeAssert.deepEqual(normalize("press_key", { app, key: "ArrowDown" }), { app, key: "Down" });
  NodeAssert.deepEqual(
    normalize("scroll", { app, elementIndex: 2, direction: "down", amount: 0.5 }),
    {
      app,
      element_index: "2",
      direction: "down",
      pages: 0.5,
    },
  );
  NodeAssert.deepEqual(
    normalize("perform_secondary_action", { app, elementIndex: 0, action: "Raise" }),
    { app, element_index: "0", action: "Raise" },
  );
  NodeAssert.deepEqual(normalize("set_value", { app, elementIndex: 3, value: "" }), {
    app,
    element_index: "3",
    value: "",
  });
  NodeAssert.deepEqual(normalize("drag", { app, fromX: 10, fromY: 20, toX: 30, toY: 40 }), {
    app,
    from_x: 10,
    from_y: 20,
    to_x: 30,
    to_y: 40,
  });
  NodeAssert.deepEqual(
    normalize("get_app_state", { app, windowId: "legacy", includeScreenshot: true }),
    { app },
  );
});

test("older or unknown backend fails closed instead of ignoring click_method", () => {
  for (const schema of [undefined, {}, { properties: { click_method: { enum: ["auto"] } } }]) {
    NodeAssert.throws(
      () => assertCoordinateClickSupported(schema, "app_post"),
      /unsafe auto fallback is disabled/,
    );
  }
  NodeAssert.doesNotThrow(() =>
    assertCoordinateClickSupported(
      { properties: { click_method: { enum: ["auto", "app_post"] } } },
      "app_post",
    ),
  );
});

test("unsupported drag targets and secondary actions are not silently converted", () => {
  NodeAssert.throws(
    () => normalize("drag", { app, fromElementIndex: 1, toElementIndex: 2 }),
    /fromX/,
  );
  NodeAssert.throws(
    () => normalize("perform_secondary_action", { app, elementIndex: 1 }),
    /action/,
  );
  NodeAssert.throws(
    () => normalize("scroll", { app, elementIndex: 1, direction: "down", amount: 0 }),
    /positive/,
  );
});

test("explicit VM delivery is supported without allowing auto/global fallback", () => {
  NodeAssert.equal(
    normalize("click", { app, x: 500, y: 350, coordinateMethod: "sky_click" }).click_method,
    "sky_click",
  );
  for (const coordinateMethod of ["auto", "global", "accessibility"]) {
    NodeAssert.throws(() => normalize("click", { app, x: 1, y: 2, coordinateMethod }));
  }
  NodeAssert.throws(() =>
    normalize("click", { app, x: 1, y: 2, coordinateMethod: "sky_click", button: "right" }),
  );
  NodeAssert.throws(() =>
    assertCoordinateClickSupported(
      { properties: { click_method: { enum: ["app_post"] } } },
      "sky_click",
    ),
  );
});
