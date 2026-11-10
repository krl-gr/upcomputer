import type { BackgroundNotice, DesktopUpdateState, ServerProvider } from "@t3tools/contracts";

/**
 * What the footer's mocked data sources return; each footer state's `setup` sets it.
 * Kept apart from sidebarFooter.fixture.tsx so `vi.mock` factories can import it
 * without importing the footer they mock.
 */
export const footerSource = {
  update: null as DesktopUpdateState | null,
  notices: [] as ReadonlyArray<BackgroundNotice>,
  providers: [] as ReadonlyArray<ServerProvider>,
  pullRequestsSupported: false,
  pathname: "/",
};
