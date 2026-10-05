import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  mergeWithDefaultKeybindings,
} from "@t3tools/shared/keybindings";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RightPanelTabs } from "../components/RightPanelTabs";
import { SidebarThreadHeader } from "../components/sidebar/SidebarThreadHeader";
import { SidebarProvider } from "../components/ui/sidebar";
import { filterAvailableSettingsSearchItems } from "../components/settings/settingsSearch";
import {
  isProductFeatureShown,
  isProductKeybindingShown,
  isProductSettingsSearchItemVisible,
  productSurface,
  withoutHiddenProductKeybindings,
} from "./productFlags";

// Unit tests see core with upstream's flags and surfaces; this file switches
// to the UpComputer product's per test.
const product = vi.hoisted(() => ({ hidden: false }));
vi.mock("./productEntry", async () => {
  const { composeExperimentalWebFeatures } = await import("./WebProduct");
  const {
    UPCOMPUTER_PRODUCT_FLAGS,
    UPCOMPUTER_PRODUCT_SURFACES,
    UPSTREAM_PRODUCT_FLAGS,
    UPSTREAM_PRODUCT_SURFACES,
  } = await import("@t3tools/shared/productFlags");
  return {
    WEB_PRODUCT: {
      ...composeExperimentalWebFeatures([]),
      get flags() {
        return product.hidden ? UPCOMPUTER_PRODUCT_FLAGS : UPSTREAM_PRODUCT_FLAGS;
      },
      get surfaces() {
        return product.hidden ? UPCOMPUTER_PRODUCT_SURFACES : UPSTREAM_PRODUCT_SURFACES;
      },
    },
  };
});

afterEach(() => {
  product.hidden = false;
});

function renderLauncher() {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={[]}
      environmentId={null}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
      onAddBrowser={() => undefined}
      onAddBrowserInProfile={() => undefined}
      onAddTerminal={() => undefined}
      onAddPullRequest={() => undefined}
      onAddPullRequests={() => undefined}
      onAddDiff={() => undefined}
      onAddFiles={() => undefined}
      onAddDevice={() => undefined}
      browserAvailable
      terminalAvailable
      diffAvailable
      filesAvailable
      pullRequestAvailable
      pullRequestsAvailable
      deviceAvailable
    >
      <div>content</div>
    </RightPanelTabs>,
  );
}

const HIDDEN_SURFACES = [">Terminal<", ">Pull request<", ">Linked pull requests<", ">Device<"];
const KEPT_SURFACES = [">Browser<", ">Files<", ">Diff<"];

describe("hidden upstream features in the web app", () => {
  it("keeps every upstream entry point with upstream's flags", () => {
    expect(isProductFeatureShown("terminal")).toBe(true);
    const html = renderLauncher();
    for (const label of [...HIDDEN_SURFACES, ...KEPT_SURFACES]) expect(html).toContain(label);
    expect(withoutHiddenProductKeybindings(DEFAULT_RESOLVED_KEYBINDINGS)).toEqual(
      DEFAULT_RESOLVED_KEYBINDINGS,
    );
  });

  it("leaves the terminal, pull request and device surfaces out of the right-panel launcher", () => {
    product.hidden = true;
    const html = renderLauncher();
    for (const label of HIDDEN_SURFACES) expect(html).not.toContain(label);
    for (const label of KEPT_SURFACES) expect(html).toContain(label);
  });

  it("drops the hidden features' default shortcuts", () => {
    product.hidden = true;
    const commands = withoutHiddenProductKeybindings(mergeWithDefaultKeybindings([])).map(
      (binding) => binding.command,
    );
    for (const command of ["terminal.toggle", "terminal.new", "pullRequest.copyNumber"]) {
      expect(commands).not.toContain(command);
    }
    expect(commands).not.toContain("thread.settle");
    expect(commands).toEqual(expect.arrayContaining(["rightPanel.toggle", "thread.copyReference"]));
    expect(isProductKeybindingShown("script.dev.run")).toBe(false);
  });

  it("drops the hidden features' settings from settings search", () => {
    const all = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      hasMacProviderSettingsEnvironment: true,
      canManageLocalBackend: true,
      isWslSettingsRowVisible: true,
      hasThreadAutoSettlement: true,
    });
    product.hidden = true;
    const hidden = all
      .filter((item) => !isProductSettingsSearchItemVisible(item))
      .map((item) => item.id);
    // Every id the flags name must still exist upstream, so a renamed row fails here.
    expect(hidden).toEqual(
      expect.arrayContaining([
        "terminal-font",
        "pull-request-merge-method",
        "github-routing",
        "auto-settle-inactive-threads",
        "auto-settle-merged-threads",
        "days-before-auto-settle",
        "device-hosts",
        "agent-device-access",
        "device-hub",
        "device-platform-support",
        "keybinding-terminal.toggle",
        "keybinding-pullRequest.copyNumber",
        "keybinding-thread.settle",
      ]),
    );
    expect(hidden.filter((id) => !id.startsWith("keybinding-"))).toHaveLength(10);
    expect(all.find((item) => item.id === "code-font")).toBeDefined();
    expect(isProductSettingsSearchItemVisible({ id: "code-font" })).toBe(true);
  });
});

function renderSidebarHeader() {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarThreadHeader
        hasProjects
        projectScope={<span>project-scope-menu</span>}
        onNewProject={() => undefined}
        onNewThread={() => undefined}
        newThreadDisabled={false}
        newThreadShortcutLabel={null}
        newThreadInProjectShortcutLabel={null}
        showNewThreadInProjectHint={false}
        searchInputRef={{ current: null }}
        searchQuery=""
        onSearchQueryChange={() => undefined}
        onSearchKeyDown={() => undefined}
        isSearching={false}
        searchResultCount={0}
        activeSearchResultIndex={0}
        onClearSearch={() => undefined}
      />
    </SidebarProvider>,
  );
}

describe("replaceable surfaces in the web app", () => {
  it("keeps upstream's search row buttons with upstream's surfaces", () => {
    expect(productSurface("sidebarProjects")).toBe("upstream");
    const html = renderSidebarHeader();
    expect(html).toContain("project-scope-menu");
    expect(html).toContain('aria-label="Add project"');
    expect(html).toContain('aria-label="New thread"');
  });

  it("leaves only search in the row for the UpComputer sidebar sections", () => {
    product.hidden = true;
    expect(productSurface("sidebarProjects")).toBe("upcomputer");
    const html = renderSidebarHeader();
    expect(html).toContain('aria-label="Search threads"');
    expect(html).not.toContain("project-scope-menu");
    expect(html).not.toContain('aria-label="Add project"');
    expect(html).not.toContain('aria-label="New thread"');
  });
});
