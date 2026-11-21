import type { UserFeedback } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { SidebarMenu, SidebarProvider } from "../components/ui/sidebar";
import { AppAtomRegistryProvider } from "../rpc/atomRegistry";
import { SidebarNotifications } from "../sidebarNotifications/SidebarNotifications";
import { requestSendFeedback } from "./sendFeedbackStore";

const mocks = vi.hoisted(() => ({
  sent: [] as Array<UserFeedback>,
}));

function setup() {
  mocks.sent.length = 0;
}

// Data sources, not UI: the update feed, server data, Update everything's plan,
// the survey, the Connect account, and where feedback is sent.
vi.mock("../state/desktopUpdate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDesktopUpdateState: () => null,
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
vi.mock("../userSurvey/useUserSurvey", () => ({ useUserSurvey: () => null }));
vi.mock("./ConnectAccountEmail", () => ({
  WithConnectAccountEmail: ({
    children,
  }: {
    readonly children: (accountEmail: string | null) => unknown;
  }) => children("alex@example.com"),
}));
vi.mock("./useSendFeedback", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSendFeedback: () => ({
    available: true,
    systemInfo: { appVersion: "0.9.3", system: "macOS (arm64)", providers: ["Codex"] },
    submit: async (feedback: UserFeedback) => {
      mocks.sent.push(feedback);
      return null;
    },
  }),
}));

function Bell() {
  return (
    <AppAtomRegistryProvider>
      <SidebarProvider>
        {/* The popover opens upward from the bell. */}
        <div style={{ paddingTop: 560 }}>
          <SidebarMenu>
            <SidebarNotifications />
          </SidebarMenu>
        </div>
      </SidebarProvider>
    </AppAtomRegistryProvider>
  );
}

describe("Send feedback", () => {
  it("opens from the command palette, keeps the draft when closed, and sends what is checked", async () => {
    setup();
    await using _screen = await render(<Bell />);

    requestSendFeedback();
    const text = page.getByRole("textbox", { name: "Your feedback" });
    await expect.element(text).toHaveFocus();
    await userEvent.fill(text.element(), "The sidebar flickers");

    await userEvent.keyboard("{Escape}");
    await expect.element(text).not.toBeInTheDocument();
    requestSendFeedback();
    await expect.element(text).toHaveValue("The sidebar flickers");

    await userEvent.click(page.getByRole("checkbox", { name: "You can email me about this" }));
    await expect
      .element(page.getByRole("textbox", { name: "Your email" }))
      .toHaveValue("alex@example.com");
    await userEvent.click(
      page.getByRole("checkbox", { name: "Include app version and system info" }),
    );
    await userEvent.click(page.getByRole("button", { name: "Send" }));

    await expect.element(page.getByText("Thanks, we got it.")).toBeInTheDocument();
    expect(mocks.sent).toEqual([{ text: "The sidebar flickers", email: "alex@example.com" }]);
  });
});
