import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The jsdom test environment cannot load this repo's test setup (it imports
// `node:sea`), so the DOM is installed by hand before React and Base UI load.
await vi.hoisted(async () => {
  // @ts-expect-error jsdom ships no type declarations and this repo has no @types/jsdom.
  const { JSDOM } = await import("jsdom");
  const { window } = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const source = window as unknown as Record<string, unknown>;
  // Node's own event classes cannot be dispatched on jsdom nodes.
  const replaced = new Set(["navigator", "Event", "CustomEvent", "EventTarget"]);
  for (const key of Object.getOwnPropertyNames(window)) {
    if (replaced.has(key) || !(key in globalThis)) {
      Object.defineProperty(globalThis, key, { configurable: true, value: source[key] });
    }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
});

const { act, cloneElement } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
type ReactNode = import("react").ReactNode;
type ReactElement = import("react").ReactElement;

const surface = vi.hoisted(() => ({ composerFooter: "upcomputer" as "upstream" | "upcomputer" }));
vi.mock("../product/productFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../product/productFlags")>()),
  productSurface: () => surface.composerFooter,
}));
// Tooltips render their text next to the trigger, so a test can read it.
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, undefined, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));

import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import type { ContextWindowSnapshot } from "../lib/contextWindow";
import { runtimeModeConfig, runtimeModeOptions } from "../components/chat/runtimeModeConfig";
import type { UpComputerComposerFooterProps } from "./UpComputerComposerFooter";

const { deriveProviderInstanceEntries } = await import("../providerInstances");
const { ContextWindowMeter } = await import("../components/chat/ContextWindowMeter");
const { ComposerFooterModelPicker } = await import("./ComposerFooterModelPicker");
const { UpComputerComposerFooter } = await import("./UpComputerComposerFooter");
const {
  composerIdlePlaceholder,
  FOLLOW_UP_COMPOSER_PLACEHOLDER,
  NEW_THREAD_COMPOSER_PLACEHOLDER,
  showsUpComputerComposerFooter,
} = await import("./composerFooterSurface");

const CLAUDE = ProviderInstanceId.make("claudeAgent");
const OPUS = "claude-opus-5-5";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
): ProviderOptionDescriptor {
  const currentValue = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(currentValue ? { currentValue } : {}),
  };
}

const EFFORT = selectDescriptor("effort", [
  { id: "medium", label: "Medium" },
  { id: "high", label: "High", isDefault: true },
]);
const CONTEXT_WINDOW = selectDescriptor("contextWindow", [
  { id: "200k", label: "200k" },
  { id: "1m", label: "1M", isDefault: true },
]);

function claudeModels(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    {
      slug: OPUS,
      name: "Claude Opus 5.5",
      isCustom: false,
      capabilities: { optionDescriptors: [...descriptors] },
    },
  ];
}

const claudeEntry = (() => {
  const provider: ServerProvider = {
    instanceId: CLAUDE,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-06T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
  return deriveProviderInstanceEntries([provider])[0]!;
})();

const usage = {
  usedTokens: 420_000,
  maxTokens: 1_000_000,
  usedPercentage: 42,
  remainingTokens: 580_000,
  remainingPercentage: 58,
  updatedAt: "2026-10-06T00:00:00.000Z",
} as unknown as ContextWindowSnapshot;

const spies = {
  onToggleInteractionMode: vi.fn(),
  onRuntimeModeChange: vi.fn(),
  onCompact: vi.fn(),
  onModelChange: vi.fn(),
};

function modelPicker(
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>,
) {
  return (
    <ComposerFooterModelPicker
      activeInstanceId={CLAUDE}
      model={OPUS}
      lockedProvider={null}
      instanceEntries={[claudeEntry]}
      modelOptionsByInstance={new Map([[CLAUDE, [{ slug: OPUS, name: "Claude Opus 5.5" }]]])}
      onInstanceModelChange={spies.onModelChange}
      {...(selectedModels ? { selectedModels } : {})}
    />
  );
}

function footerProps(
  overrides: Partial<UpComputerComposerFooterProps> & {
    descriptors?: ReadonlyArray<ProviderOptionDescriptor>;
  } = {},
): UpComputerComposerFooterProps {
  const { descriptors = [EFFORT, CONTEXT_WINDOW], ...rest } = overrides;
  const traitsInput = {
    provider: ProviderDriverKind.make("claudeAgent"),
    instanceId: CLAUDE,
    draftId: "draft-footer-test" as DraftId,
    model: OPUS,
    models: claudeModels(descriptors),
    modelOptions: undefined,
    prompt: "",
    onPromptChange: () => undefined,
    planModeEnabled: true,
    isComposerOwned: true,
  };
  return {
    attachAction: <button type="button" aria-label="Attach files" />,
    modelPicker: modelPicker(),
    providerUnavailableControl: null,
    traitsPickerInput: traitsInput,
    traitsMenuContent: <span data-testid="traits-menu-content">Effort options</span>,
    showInteractionModeToggle: true,
    interactionMode: "default",
    onToggleInteractionMode: spies.onToggleInteractionMode,
    runtimeMode: "full-access",
    runtimeModeOptions: runtimeModeOptions.map((mode) => ({ mode, ...runtimeModeConfig[mode] })),
    onRuntimeModeChange: spies.onRuntimeModeChange,
    primaryActions: (
      <>
        <ContextWindowMeter
          usage={usage}
          modelDisplayName="Claude Opus 5.5"
          onCompact={spies.onCompact}
        />
        <button type="submit" aria-label="Send message" />
      </>
    ),
    ...rest,
  };
}

/** ChatComposer's hook line: the footer row follows the surface; resting keeps upstream's. */
function FooterRow(props: { footer: UpComputerComposerFooterProps; resting?: boolean }) {
  return showsUpComputerComposerFooter(props.resting ?? false) ? (
    <UpComputerComposerFooter {...props.footer} />
  ) : (
    <div data-testid="upstream-footer" />
  );
}

let root: Root;
let container: HTMLDivElement;

function render(footer: UpComputerComposerFooterProps, resting = false) {
  return act(async () => {
    root.render(<FooterRow footer={footer} resting={resting} />);
  });
}

function leftRow() {
  return container.querySelector<HTMLElement>('[data-chat-composer-controls="left"]')!;
}

function block(id: string) {
  return container.querySelector<HTMLElement>(`[data-composer-footer-block="${id}"]`);
}

function buttonByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("button, [role=menuitemradio]")).find(
    (element) => element.textContent?.trim() === text,
  );
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Lay the row out at a fixed width: blocks 80px, the picker 160px, other controls 30px. */
function stubLayout(rowWidth: number) {
  const widthOf = (element: HTMLElement) => {
    if (element.dataset.testid === "tooltip" || element.matches("input")) return 0;
    if (element.dataset.composerFooterBlock !== undefined) return 80;
    if (element.matches("[data-chat-provider-model-picker]")) return 160;
    if (element.parentElement?.dataset.chatComposerControls === "left") return 30;
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return { width: widthOf(this), height: 0, top: 0, left: 0, right: 0, bottom: 0 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.chatComposerControls === "left" ? rowWidth : 0;
  });
}

beforeEach(() => {
  surface.composerFooter = "upcomputer";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  for (const spy of Object.values(spies)) spy.mockClear();
});

describe("composer footer surface", () => {
  it("renders the UpComputer footer with its surface and upstream's otherwise", async () => {
    await render(footerProps());
    expect(container.querySelector('[data-composer-footer-surface="upcomputer"]')).not.toBeNull();

    surface.composerFooter = "upstream";
    await render(footerProps());
    expect(container.querySelector("[data-composer-footer-surface]")).toBeNull();
    expect(container.querySelector('[data-testid="upstream-footer"]')).not.toBeNull();
  });

  it("leaves the resting row to upstream", async () => {
    await render(footerProps(), true);
    expect(container.querySelector("[data-composer-footer-surface]")).toBeNull();
  });

  it("uses V1's placeholders with its surface and upstream's text otherwise", () => {
    expect(composerIdlePlaceholder(false)).toBe(
      "Ask anything, @tag files/folders, $use skills, or / for commands",
    );
    expect(composerIdlePlaceholder(true)).toBe("Ask for follow-up changes or attach images");

    surface.composerFooter = "upstream";
    expect(composerIdlePlaceholder(true)).toBe(NEW_THREAD_COMPOSER_PLACEHOLDER);
    expect(composerIdlePlaceholder(false)).toBe(NEW_THREAD_COMPOSER_PLACEHOLDER);
    expect(FOLLOW_UP_COMPOSER_PLACEHOLDER).not.toBe(NEW_THREAD_COMPOSER_PLACEHOLDER);
  });
});

describe("UpComputerComposerFooter", () => {
  it("orders the controls as V1 did, with the ring and send on the right", async () => {
    await render(footerProps());
    const left = Array.from(
      leftRow().querySelectorAll<HTMLElement>("button:not([aria-hidden]), [role=combobox]"),
    )
      .filter((element) => !element.closest("[data-composer-footer-overflow]"))
      .map(
        (element) =>
          element.getAttribute("aria-label") ??
          element.querySelector('[data-chat-provider-model-picker-label="true"]')?.textContent ??
          element.textContent,
      );
    expect(left).toEqual([
      "Attach files",
      "Build",
      "Claude · Claude Opus 5.5",
      "High · 1M",
      "Access: Full access",
    ]);
    const right = container.querySelector('[data-chat-composer-actions="right"]')!;
    expect(
      Array.from(right.querySelectorAll("button")).map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Context window 42% used", "Send message"]);
  });

  it("shows the provider and model in one label, and keeps upstream's trigger for several models", async () => {
    await render(footerProps());
    const label = container.querySelector('[data-chat-provider-model-picker-label="true"]');
    expect(label?.textContent).toBe("Claude · Claude Opus 5.5");

    await render(
      footerProps({
        modelPicker: modelPicker([
          { instanceId: CLAUDE, model: OPUS },
          { instanceId: CLAUDE, model: "claude-sonnet-5-5" },
        ]),
      }),
    );
    expect(
      container.querySelector('[data-chat-provider-model-picker-label="true"]')?.textContent,
    ).not.toContain("Claude ·");

    surface.composerFooter = "upstream";
    await act(async () => root.render(modelPicker()));
    expect(
      container.querySelector('[data-chat-provider-model-picker-label="true"]')?.textContent,
    ).toBe("Claude Opus 5.5");
  });

  it("combines effort and context, and shows only what the model has", async () => {
    await render(footerProps());
    expect(block("traits")?.querySelector("[data-composer-control-label]")?.textContent).toBe(
      "High · 1M",
    );

    await render(footerProps({ descriptors: [EFFORT] }));
    expect(block("traits")?.querySelector("[data-composer-control-label]")?.textContent).toBe(
      "High",
    );

    await render(footerProps({ descriptors: [] }));
    expect(block("traits")).toBeNull();
  });

  it("labels the mode Build or Plan, and a click toggles it", async () => {
    await render(footerProps());
    const build = buttonByText("Build")!;
    expect(build.getAttribute("aria-pressed")).toBe("false");
    await click(build);
    expect(spies.onToggleInteractionMode).toHaveBeenCalledTimes(1);

    await render(footerProps({ interactionMode: "plan" }));
    expect(buttonByText("Plan")?.getAttribute("aria-pressed")).toBe("true");

    await render(footerProps({ showInteractionModeToggle: false }));
    expect(block("mode")).toBeNull();
  });

  it("shows access as a lock with the label in its tooltip and upstream's access menu", async () => {
    await render(footerProps());
    const access = container.querySelector<HTMLElement>("[data-composer-footer-access]")!;
    expect(access.querySelector("svg")?.classList.contains("lucide-lock-open")).toBe(true);
    expect(block("access")?.querySelector('[data-testid="tooltip"]')?.textContent).toBe(
      "Full access",
    );

    await render(footerProps({ runtimeMode: "approval-required" }));
    const supervised = container.querySelector<HTMLElement>("[data-composer-footer-access]")!;
    expect(supervised.querySelector("svg")?.classList.contains("lucide-lock")).toBe(true);
    expect(block("access")?.querySelector('[data-testid="tooltip"]')?.textContent).toBe(
      "Supervised",
    );

    await click(supervised);
    const options = Array.from(document.querySelectorAll("[role=option]")).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toHaveLength(runtimeModeOptions.length);
    expect(options[0]).toContain("Supervised");
    expect(options.at(-1)).toContain("Full access");
  });

  it("keeps upstream's context ring, and the ring still compacts", async () => {
    await render(footerProps());
    const ring = container.querySelector<HTMLElement>('[aria-label="Context window 42% used"]')!;
    await click(ring);
    await click(buttonByText("Compact context")!);
    expect(spies.onCompact).toHaveBeenCalledTimes(1);
  });

  it("shows upstream's provider setup control instead of the controls when no provider is available", async () => {
    await render(
      footerProps({
        providerUnavailableControl: <button type="button">Open provider settings</button>,
      }),
    );
    expect(buttonByText("Open provider settings")).toBeDefined();
    expect(block("access")).toBeNull();
    expect(container.querySelector('[aria-label="Send message"]')).not.toBeNull();
  });

  it("keeps every control in the row when it fits", async () => {
    stubLayout(600);
    await render(footerProps());
    for (const id of ["mode", "traits", "access"]) {
      expect(block(id)?.getAttribute("aria-hidden")).toBeNull();
    }
    expect(
      container.querySelector("[data-composer-footer-overflow]")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("folds trailing controls into upstream's overflow menu at a narrow width", async () => {
    // 220px of fixed controls and three 80px blocks: 340px keeps only the mode block.
    stubLayout(340);
    await render(footerProps());
    expect(block("mode")?.getAttribute("aria-hidden")).toBeNull();
    expect(block("traits")?.getAttribute("aria-hidden")).toBe("true");
    expect(block("access")?.getAttribute("aria-hidden")).toBe("true");

    const overflow = container.querySelector<HTMLElement>("[data-composer-footer-overflow]")!;
    expect(overflow.getAttribute("aria-hidden")).toBeNull();
    await click(overflow.querySelector('[aria-label="More composer controls"]')!);
    expect(document.querySelector('[data-testid="traits-menu-content"]')).not.toBeNull();
    expect(buttonByText("Full access")).toBeDefined();
    expect(buttonByText("Plan")).toBeUndefined();
  });
});
