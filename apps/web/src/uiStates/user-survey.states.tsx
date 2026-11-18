import type { DesktopUpdateState, UserSurvey } from "@t3tools/contracts";
import { it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { Dialog } from "../components/ui/dialog";
import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { UserSurveyDialogPopup, type UserSurveyStatus } from "../userSurvey/UserSurveyDialog";
import { EMPTY_DRAFT_ANSWER, type SurveyDraft } from "../userSurvey/userSurvey.logic";
import { captureUiStateSheet, type UiState } from "./uiStateSheet";

/*
 * The survey's card in the notifications popover, and each step of its form.
 * Popups portal to the body, so each state copies the open popup into its cell.
 */

// The survey as the server hands it over, parsed from PostHog's definition.
const SURVEY: UserSurvey = {
  id: "0199a1b2-0000-7000-8000-000000000001",
  name: "How can we improve Up.computer",
  questions: [
    {
      id: "q-working",
      type: "single_choice",
      question: "Hi 👋 Is everything working fine in Up.computer?",
      optional: false,
      choices: ["Yes", "There are issues"],
      hasOpenChoice: false,
    },
    {
      id: "q-details",
      type: "open",
      question: "Can you provide details so we can fix it ASAP?",
      description: "What happened, and where?",
      optional: true,
      showWhen: { questionId: "q-working", choices: [1] },
    },
    {
      id: "q-missing",
      type: "multiple_choice",
      question: "What are you missing?",
      optional: true,
      choices: [
        "Mobile app",
        "Claude agents",
        "Voice",
        "Access to bots in Slack",
        "Bot in video calls",
        "Document editing",
        "Other",
      ],
      hasOpenChoice: true,
    },
    {
      id: "q-else",
      type: "open",
      question: "Can we reach you with follow-up questions? Leave your email or X handle.",
      optional: true,
    },
  ],
};

const source = vi.hoisted(() => ({
  update: null as DesktopUpdateState | null,
  survey: true,
}));

// Data sources, not UI: the update feed, server configs, environments, Update
// everything's plan and the survey the server offers.
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
          dismiss: () => undefined,
          submit: async () => null,
          finish: () => undefined,
        }
      : null,
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

/** Waits for the popup's opening transition, then copies it into `cell`. */
async function copyPopup(popup: HTMLElement, cell: HTMLElement) {
  await Promise.all(
    popup
      .getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
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

// A chip of the survey card in the popup's copy; the sheet marks it as hovered.
const FIRST_CHIP = "[data-popup-copy] [role=radio]:first-child";
const DISMISS = '[data-popup-copy] li:last-child [aria-label="Dismiss"]';

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

function bell(name: string, update: DesktopUpdateState | null, hover?: string): UiState {
  return {
    name,
    render: () => <Bell />,
    ...(hover ? { hover } : {}),
    setup: () => {
      source.update = update;
      return () => {
        source.update = null;
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
      await copyPopup(popup, cell);
      await userEvent.unhover(trigger);
    },
  };
}

const YES: SurveyDraft = { "q-working": { ...EMPTY_DRAFT_ANSWER, picked: [0] } };
const issues = (details: string): SurveyDraft => ({
  "q-working": { ...EMPTY_DRAFT_ANSWER, picked: [1] },
  "q-details": { ...EMPTY_DRAFT_ANSWER, text: details },
});
const FILLED: SurveyDraft = {
  ...issues("The sidebar flickers when a thread finishes."),
  "q-missing": { ...EMPTY_DRAFT_ANSWER, picked: [0, 2, 6], otherText: "Calendar sync" },
  "q-else": { ...EMPTY_DRAFT_ANSWER, text: "demo@example.com" },
};

function form(name: string, draft: SurveyDraft, step: number, status: UserSurveyStatus): UiState {
  return {
    name,
    render: () => (
      <AppAtomRegistryProvider>
        <div data-popup-copy="" />
        <Dialog open>
          <UserSurveyDialogPopup
            survey={SURVEY}
            draft={draft}
            status={status}
            step={step}
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
        // Earlier states' copies sit in the sheet with the same slot.
        const found = [
          ...document.querySelectorAll<HTMLElement>('[data-slot="dialog-popup"]'),
        ].find((popup) => !popup.closest("[data-ui-states-sheet]"));
        if (!found) throw new Error("The dialog is not open");
        return found;
      });
      await copyPopup(popup, cell);
    },
  };
}

const EDITING: UserSurveyStatus = { kind: "editing" };

it("user-survey", async () => {
  // Several sheets: a taller capture comes out blank past about 4000px.
  await captureUiStateSheet(
    "user-survey-card",
    [
      {
        title: "Notifications popover: the card asks the first question",
        states: [
          bell("after an app update", AVAILABLE),
          bell("alone", null),
          bell("pointer over a chip", AVAILABLE, FIRST_CHIP),
          bell("pointer over the X", AVAILABLE, DISMISS),
        ],
      },
    ],
    { cellWidth: 360 },
  );
  await captureUiStateSheet(
    "user-survey-form",
    [
      {
        title: "Survey form: the steps follow the card's answer",
        states: [
          form("There are issues, step 1 of 3: the details", issues(""), 0, EDITING),
          form(
            "There are issues, step 2 of 3: Skip until a chip is picked",
            issues(""),
            1,
            EDITING,
          ),
          form(
            "There are issues, step 2 of 3: chips and Other with its text area",
            {
              ...issues("The sidebar flickers when a thread finishes."),
              "q-missing": { ...EMPTY_DRAFT_ANSWER, picked: [2, 6], otherText: "Calendar sync" },
            },
            1,
            EDITING,
          ),
          form("There are issues, step 3 of 3: the contact", issues(""), 2, EDITING),
          form("Yes, step 1 of 2: what is missing", YES, 0, EDITING),
          form("Yes, step 2 of 2: the contact", YES, 1, EDITING),
        ],
      },
    ],
    { cellWidth: 560 },
  );
  await captureUiStateSheet(
    "user-survey-send",
    [
      {
        title: "Sending",
        states: [
          form("submitting", FILLED, 2, { kind: "submitting" }),
          form("send failed: the error under the field", FILLED, 2, {
            kind: "failed",
            message: "Could not send your answers. Check your connection and try again.",
          }),
          form("sent: thank you", FILLED, 2, { kind: "sent" }),
        ],
      },
    ],
    { cellWidth: 560 },
  );
});
