import type { DesktopUpdateState, UserSurvey } from "@t3tools/contracts";
import { it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { Dialog } from "../components/ui/dialog";
import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { UserSurveyDialogPopup } from "../userSurvey/UserSurveyDialog";
import { EMPTY_DRAFT_ANSWER } from "../userSurvey/userSurvey.logic";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * Send feedback: its button in the notifications popover, the form that takes
 * the popover over, and the hint on the survey's thank-you. Each popover state
 * drives the real button and form, then copies the open popup into its cell.
 */

const SURVEY: UserSurvey = {
  id: "feedback-2026-11",
  name: "Feedback, November 2026",
  questions: [
    {
      id: "working",
      type: "single_choice",
      question: "Hi 👋 Is Up.computer working well for you?",
      optional: false,
      choices: [{ label: "All good" }, { label: "Something's off" }],
    },
    {
      id: "contact",
      type: "open",
      kind: "contact",
      question: "Can we follow up with you? Leave your email or X handle.",
      optional: true,
    },
  ],
};

type Send = "pending" | "sent" | "failed";

const source = vi.hoisted(() => ({
  update: null as DesktopUpdateState | null,
  survey: false,
  accountEmail: null as string | null,
  send: "sent" as "pending" | "sent" | "failed",
}));

// Data sources, not UI: the update feed, server configs, environments, Update
// everything's plan, the survey the server offers, and where feedback is sent.
vi.mock("../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesktopUpdateState: () => source.update,
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerConfigs: () => new Map(),
}));
vi.mock("../state/environments", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEnvironments: () => ({ environments: [] }),
  useEnvironmentProviders: () => new Map(),
}));
vi.mock("../components/sidebar/useUpdateEverything", async (importOriginal) => {
  const { describeUpdateEverything } = await import("../components/sidebar/updateEverything.logic");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useUpdateEverything: (localUpdateVersion: string | null) => ({
      hasUpdates: false,
      ...describeUpdateEverything({
        localVersion: localUpdateVersion,
        localMachines: [],
        servers: [],
        providerMachines: [],
        skipped: [],
      }),
      restarts: [],
      run: async () => undefined,
    }),
  };
});
vi.mock("../userSurvey/useUserSurvey", () => ({
  useUserSurvey: () =>
    source.survey
      ? {
          survey: SURVEY,
          shown: () => undefined,
          partial: () => undefined,
          dismiss: () => undefined,
          submit: async () => null,
          finish: () => undefined,
        }
      : null,
}));
vi.mock("../sendFeedback/ConnectAccountEmail", () => ({
  WithConnectAccountEmail: ({
    children,
  }: {
    readonly children: (accountEmail: string | null) => unknown;
  }) => children(source.accountEmail),
}));
vi.mock("../sendFeedback/useSendFeedback", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSendFeedbackAvailable: () => true,
  useSendFeedback: () => ({
    available: true,
    systemInfo: {
      appVersion: "0.9.3",
      system: "macOS 15.2 (arm64)",
      providers: ["Claude", "Codex"],
    },
    submit: () =>
      source.send === "pending"
        ? new Promise<never>(() => undefined)
        : Promise.resolve(
            source.send === "failed" ? "Couldn't send. Check your connection and try again." : null,
          ),
  }),
}));

const AVAILABLE: DesktopUpdateState = {
  enabled: true,
  status: "available",
  channel: "latest",
  currentVersion: "0.9.2",
  hostArch: "arm64",
  appArch: "arm64",
  runningUnderArm64Translation: false,
  availableVersion: "0.9.3",
  downloadedVersion: null,
  releaseNotes: [],
  omittedReleaseCount: 0,
  downloadPercent: null,
  checkedAt: new Date().toISOString(),
  message: null,
  errorContext: null,
  canRetry: false,
};

/** Waits for the popup's transitions, then copies it into `cell`. */
async function copyPopup(popup: HTMLElement, cell: HTMLElement) {
  await Promise.all(
    popup
      .getAnimations({ subtree: true })
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().endTime !== Infinity &&
          // The feedback hint's loop runs about 12s; the capture does not wait for it.
          !(
            animation.effect instanceof KeyframeEffect &&
            animation.effect.target?.closest("[data-sfh]")
          ),
      )
      // A transition its element cancels rejects; the popup is settled either way.
      .map((animation) => animation.finished.catch(() => undefined)),
  );
  const copy = popup.cloneNode(true) as HTMLElement;
  copy.removeAttribute("data-starting-style");
  copy.removeAttribute("id");
  for (const property of ["position", "top", "bottom", "left", "right"]) {
    copy.style.removeProperty(property);
  }
  cell.querySelector("[data-popup-copy]")!.append(copy);
}

const SEND_FEEDBACK = '[data-track="notifications.send-feedback"]';
const CAN_EMAIL = '[data-track="feedback.can-email"]';
const TEXT = "The sidebar flickers when a thread finishes. It started after the last update.";

function Bell() {
  return (
    <AppAtomRegistryProvider>
      <SidebarProvider className="min-h-0" data-sidebar-compact="false">
        <div data-app-sidebar="" className="flex flex-col py-2">
          <div data-popup-copy="" className="mb-1 empty:hidden" />
          <SidebarMenu className="flex-row items-center">
            <SidebarNotifications />
          </SidebarMenu>
        </div>
      </SidebarProvider>
    </AppAtomRegistryProvider>
  );
}

interface PopoverState {
  readonly update?: DesktopUpdateState;
  readonly survey?: boolean;
  readonly accountEmail?: string;
  readonly send?: Send;
  readonly hover?: string;
  /** Drives the open popover before it is copied. */
  readonly act?: (popup: HTMLElement) => Promise<void>;
}

function popover(name: string, state: PopoverState = {}): UiState {
  return {
    name,
    render: () => <Bell />,
    ...(state.hover ? { hover: `[data-popup-copy] ${state.hover}` } : {}),
    setup: () => {
      source.update = state.update ?? null;
      source.survey = state.survey ?? false;
      source.accountEmail = state.accountEmail ?? null;
      source.send = state.send ?? "sent";
      return () => {
        source.update = null;
        source.survey = false;
        source.accountEmail = null;
        source.send = "sent";
      };
    },
    settle: async (cell) => {
      const trigger = cell.querySelector<HTMLElement>('[data-track="sidebar.notifications"]')!;
      await userEvent.click(trigger);
      const popup = await vi.waitFor(() => {
        const id = trigger.getAttribute("aria-controls");
        const found = id ? document.getElementById(id) : null;
        if (!found?.hasAttribute("data-open")) throw new Error("The popover is not open");
        return found;
      });
      await state.act?.(popup);
      await copyPopup(popup, cell);
      await userEvent.unhover(trigger);
    },
  };
}

async function openForm(popup: HTMLElement) {
  await userEvent.click(popup.querySelector<HTMLElement>(SEND_FEEDBACK)!);
  return vi.waitFor(() => {
    const form = popup.querySelector("form");
    if (!form) throw new Error("The form is not open");
    return form;
  });
}

async function fill(popup: HTMLElement, options: { email?: string; canEmail?: boolean } = {}) {
  const form = await openForm(popup);
  await userEvent.fill(form.querySelector("textarea")!, TEXT);
  if (options.canEmail) await userEvent.click(form.querySelector<HTMLElement>(CAN_EMAIL)!);
  if (options.email !== undefined) {
    await userEvent.fill(form.querySelector('input[type="email"]')!, options.email);
  }
  return form;
}

async function send(popup: HTMLElement, options: { email?: string; canEmail?: boolean } = {}) {
  const form = await fill(popup, options);
  await userEvent.click(form.querySelector<HTMLElement>('button[type="submit"]')!);
}

/**
 * Draws the hint's loop as it stands at `seconds`: the capture cancels endless
 * animations, so each moving part gets that moment's values as its own style.
 */
function holdLoopFrame(root: HTMLElement, seconds: number) {
  for (const part of root.querySelectorAll<HTMLElement | SVGElement>("[data-sfh]")) {
    for (const animation of part.getAnimations()) {
      animation.pause();
      animation.currentTime = seconds * 1000;
    }
    const { opacity, transform } = getComputedStyle(part);
    part.style.animation = "none";
    part.style.opacity = opacity;
    part.style.transform = transform;
  }
}

/** The survey's thank-you with the hint's loop frozen at `seconds`. */
function thanks(name: string, seconds: number, width?: number): UiState {
  return {
    name,
    render: () => (
      <AppAtomRegistryProvider>
        <div data-popup-copy="" className="mx-auto" style={width ? { width } : undefined} />
        <Dialog open>
          <UserSurveyDialogPopup
            survey={SURVEY}
            draft={{ working: { ...EMPTY_DRAFT_ANSWER, picked: [0] } }}
            status={{ kind: "sent" }}
            step={1}
            back={false}
            onDraftChange={() => undefined}
            onStepChange={() => undefined}
            onSubmit={() => undefined}
            onClose={() => undefined}
            onBackToCard={() => undefined}
          />
        </Dialog>
      </AppAtomRegistryProvider>
    ),
    // Freezes the copy, so the open dialog's backdrop leaves with the state.
    setup: () => () => undefined,
    settle: async (cell) => {
      const popup = await vi.waitFor(() => {
        const found = [
          ...document.querySelectorAll<HTMLElement>('[data-slot="dialog-popup"]'),
        ].find((popup) => !popup.closest("[data-ui-states-sheet]"));
        if (!found) throw new Error("The dialog is not open");
        return found;
      });
      await copyPopup(popup, cell);
      const copy = cell.querySelector<HTMLElement>("[data-popup-copy]")!;
      // The auto-height wrapper holds the wide dialog's height; a narrower copy is taller.
      if (width) {
        for (const sized of copy.querySelectorAll<HTMLElement>("[style*=height]")) {
          if (!sized.closest("[data-popup-copy] [aria-hidden]"))
            sized.style.removeProperty("height");
        }
      }
      holdLoopFrame(copy, seconds);
    },
  };
}

it("send-feedback", async () => {
  // Several sheets: a taller capture comes out blank past about 4000px.
  await captureUiStateSheet(
    "send-feedback-button",
    [
      {
        title: "Notifications popover: Send feedback at the bottom",
        states: [
          popover("no notifications"),
          popover("with notifications", { update: AVAILABLE, survey: true }),
          popover("pointer over Send feedback", { update: AVAILABLE, hover: SEND_FEEDBACK }),
        ],
      },
    ],
    { cellWidth: 360 },
  );
  await captureUiStateSheet(
    "send-feedback-form",
    [
      {
        title: "The form takes the popover over",
        states: [
          popover("empty: Send waits for some text", {
            act: async (popup) => void (await openForm(popup)),
          }),
          popover("What's included, opened", {
            act: async (popup) => {
              const form = await openForm(popup);
              await userEvent.click(form.querySelector<HTMLElement>("[aria-expanded]")!);
            },
          }),
          popover("filled", { act: async (popup) => void (await fill(popup)) }),
          popover("email box on, signed out: an empty email field", {
            act: async (popup) => void (await fill(popup, { canEmail: true })),
          }),
          popover("email box on, signed out: an email typed", {
            act: async (popup) =>
              void (await fill(popup, { canEmail: true, email: "demo@example.com" })),
          }),
          popover("email box on, signed in to Connect: the account's email, prefilled", {
            accountEmail: "alex@example.com",
            act: async (popup) => void (await fill(popup, { canEmail: true })),
          }),
        ],
      },
    ],
    { cellWidth: 360 },
  );
  await captureUiStateSheet(
    "send-feedback-send",
    [
      {
        title: "Sending",
        states: [
          popover("sending", {
            send: "pending",
            act: (popup) => send(popup, { canEmail: true, email: "demo@example.com" }),
          }),
          popover("send failed: the error and Try again", {
            send: "failed",
            act: (popup) => send(popup),
          }),
          popover("sent: thanks, then back to the list", { act: (popup) => send(popup) }),
          popover("sent with an email", {
            act: (popup) => send(popup, { canEmail: true, email: "demo@example.com" }),
          }),
        ],
      },
    ],
    { cellWidth: 360 },
  );
  await captureUiStateSheet(
    "send-feedback-hint",
    [
      {
        title: "Survey thank-you: the hint's loop, frame by frame (4s)",
        states: [
          thanks("0.4s: the pointer comes in", 0.4),
          thanks("0.95s: it clicks the bell", 0.95),
          thanks("1.4s: the popover is open", 1.4),
          thanks("2.6s: Send feedback lights up (also the reduced-motion still)", 2.6),
          thanks("phone width, 343px", 2.6, 343),
        ],
      },
    ],
    { cellWidth: 560 },
  );
});
