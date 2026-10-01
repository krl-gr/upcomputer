import {
  DEFAULT_TASK_PROMPT_SETTINGS,
  INSTRUCTIONS_FIELDS,
  type InstructionsField,
  type TaskPromptSettings,
  type TaskPromptSettingsUpdateInput,
} from "@upcomputer/tasks-contracts/v1";
import { act, createElement, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const setup = vi.hoisted(() => ({
  server: {} as Record<string, string>,
  allChats: "",
  configs: new Map<string, unknown>(),
  getPromptSettings: vi.fn(),
  updatePromptSettings: vi.fn(),
}));

const api = vi.hoisted(() => ({
  tasks: {
    getPromptSettings: setup.getPromptSettings,
    updatePromptSettings: setup.updatePromptSettings,
  },
}));

vi.mock("../../../../apps/web/src/components/ui/button.tsx", () => ({
  Button: ({ children, ...props }: { children: ReactNode }) =>
    createElement("button", props, children),
}));
vi.mock("../../../../apps/web/src/components/ui/toast.tsx", () => ({
  toastManager: { add: () => {} },
}));
vi.mock("../../../../apps/web/src/components/settings/settingsLayout.tsx", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("../../../../apps/web/src/extensionApi.ts", () => ({
  readEnvironmentExtensionApi: () => api,
}));
vi.mock("../../../../apps/web/src/hooks/useSettings.ts", () => ({
  usePrimarySettings: (select: (settings: { customInstructions: string }) => string) =>
    select({ customInstructions: setup.allChats }),
}));
vi.mock("../../../../apps/web/src/lib/utils.ts", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));
vi.mock("../../../../apps/web/src/state/environments.ts", () => ({
  usePrimaryEnvironmentId: () => "environment-1",
}));
vi.mock("../../../../apps/web/src/state/entities.ts", () => ({
  useServerConfigs: () => setup.configs,
}));
vi.mock("../../../../apps/web/src/state/server.ts", () => ({
  serverEnvironment: { updateSettings: "updateSettings" },
}));
vi.mock("../../../../apps/web/src/state/use-atom-command.ts", () => ({
  useAtomCommand: () => async () => ({ _tag: "Failure" }),
}));
vi.mock("@upcomputer/client-runtime/state/runtime", () => ({
  squashAtomCommandFailure: () => new Error("settings failed"),
}));
vi.mock("../environmentApi.ts", () => ({ TASKS_WEB_ENVIRONMENT_API: "tasks" }));

import InstructionsSettingsPage from "./InstructionsSettingsPage.tsx";

const original: TaskPromptSettings = {
  ...DEFAULT_TASK_PROMPT_SETTINGS,
  taskCreation: "Original creation",
  taskExecution: "Original execution",
};

let renderer: ReactTestRenderer;

/** The server refuses a field whose base differs from its current text, like the Tasks store. */
function updateServerTexts(input: TaskPromptSettingsUpdateInput) {
  const conflicts: InstructionsField[] = [];
  for (const field of INSTRUCTIONS_FIELDS) {
    const text = input[field];
    if (text === undefined) continue;
    const current = field === "allChats" ? setup.allChats : setup.server[field];
    if (input.base?.[field] !== current) conflicts.push(field);
    else if (field === "allChats") setup.allChats = text;
    else setup.server[field] = text;
  }
  return { ...setup.server, allChats: setup.allChats, conflicts };
}

async function render() {
  await act(async () => {
    renderer = create(createElement(InstructionsSettingsPage));
  });
}

/** A config event: a new config map, as provider status or settings updates deliver. */
async function deliverConfigs() {
  setup.configs = new Map(setup.configs);
  await act(async () => {
    renderer.update(createElement(InstructionsSettingsPage));
  });
}

function button(label: string): ReactTestInstance {
  return renderer.root.find((node) => node.type === "button" && node.props.children === label);
}

async function openTab(label: string) {
  await act(async () => button(label).props.onClick());
}

function editorText(): string {
  return renderer.root.findByType("textarea").props.value as string;
}

async function type(value: string) {
  await act(async () =>
    renderer.root.findByType("textarea").props.onChange({ currentTarget: { value } }),
  );
}

async function save() {
  await act(async () => button("Save changes").props.onClick());
}

function errorText(): string | undefined {
  const [error] = renderer.root.findAll(
    (node) => node.type === "p" && String(node.props.className).includes("text-destructive"),
  );
  return error?.props.children as string | undefined;
}

describe("InstructionsSettingsPage reloads", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    setup.server = { ...original };
    setup.allChats = "Original all chats";
    setup.configs = new Map([["environment-1", {}]]);
    setup.getPromptSettings.mockImplementation(async () => ({ ...setup.server }));
    setup.updatePromptSettings.mockImplementation(async (input: TaskPromptSettingsUpdateInput) =>
      updateServerTexts(input),
    );
  });

  afterEach(() => {
    act(() => renderer.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps a task edit through a config event and still refuses it if the server text changed", async () => {
    await render();
    await openTab("Task creation");
    await type("Unsaved page edit");

    // A chat changes the texts; any config event then reloads the page.
    setup.server = {
      ...setup.server,
      taskCreation: "Chat creation",
      taskExecution: "Chat execution",
    };
    setup.allChats = "Chat all chats";
    await deliverConfigs();

    expect(setup.getPromptSettings).toHaveBeenCalledTimes(2);
    expect(editorText()).toBe("Unsaved page edit");
    expect(renderer.root.findByType("textarea").props.disabled).toBe(false);
    await openTab("Task execution");
    expect(editorText()).toBe("Chat execution");
    await openTab("All chats");
    expect(editorText()).toBe("Chat all chats");

    await save();
    expect(setup.updatePromptSettings).toHaveBeenCalledWith({
      taskCreation: "Unsaved page edit",
      base: { taskCreation: "Original creation" },
    });
    expect(setup.server.taskCreation).toBe("Chat creation");
    expect(errorText()).toContain("Task creation changed elsewhere");
    await openTab("Task creation");
    expect(editorText()).toBe("Unsaved page edit");
  });

  it("keeps an All chats edit through a config event and still refuses it if the server text changed", async () => {
    await render();
    await type("Unsaved all chats");

    setup.server = { ...setup.server, taskCreation: "Chat creation" };
    setup.allChats = "Chat all chats";
    await deliverConfigs();

    expect(editorText()).toBe("Unsaved all chats");
    await openTab("Task creation");
    expect(editorText()).toBe("Chat creation");

    await save();
    expect(setup.updatePromptSettings).toHaveBeenCalledWith({
      allChats: "Unsaved all chats",
      base: { allChats: "Original all chats" },
    });
    expect(setup.allChats).toBe("Chat all chats");
    expect(errorText()).toContain("All chats changed elsewhere");
  });

  it("saves an edit when the server text is unchanged, and Cancel loads the newer text", async () => {
    await render();
    await openTab("Task creation");
    await type("Page creation");
    await openTab("Task execution");
    await type("Page execution");
    setup.server = { ...setup.server, taskExecution: "Chat execution" };
    await deliverConfigs();

    await openTab("Task creation");
    await act(async () => button("Cancel").props.onClick());
    expect(editorText()).toBe("Original creation");
    await openTab("Task execution");
    expect(editorText()).toBe("Chat execution");

    await openTab("Task creation");
    await type("Page creation");
    await save();
    expect(setup.server.taskCreation).toBe("Page creation");
    expect(errorText()).toBeUndefined();
  });
});
