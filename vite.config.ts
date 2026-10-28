import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";
import { remoteCacheUrl } from "./infra/task-cache/src/remoteCache.ts";
import { cachedTestTasks } from "./scripts/lib/cached-tests.ts";

// Up.computer tests written for jsdom and react-test-renderer before upstream
// moved web DOM tests to the browser project. Move each to
// *.browser.test.{ts,tsx} and drop it here.
const UPCOMPUTER_LEGACY_DOM_TESTS: Array<string> = [
  "apps/web/src/components/ProviderUpdateLaunchNotification.lifecycle.test.tsx",
  "apps/web/src/components/settings/CodexSetupSection.test.tsx",
  "apps/web/src/components/settings/ProviderAuthenticationSection.test.tsx",
  "apps/web/src/composerContextRow/ThreadHeaderProjects.test.tsx",
  "apps/web/src/composerContextRow/UpComputerComposerContextRow.test.tsx",
  "apps/web/src/composerContextRow/chatHeader.test.tsx",
  "apps/web/src/composerContextRow/draftHeroProjectPicker.test.tsx",
  "apps/web/src/composerFooter/UpComputerComposerFooter.test.tsx",
  "apps/web/src/composerFooter/composerLookChromium.test.tsx",
  "apps/web/src/onboardingSurface/FirstRunAgent.test.tsx",
  "apps/web/src/onboardingSurface/UpComputerOnboarding.test.tsx",
  "apps/web/src/product/tasksSurface.test.tsx",
  "apps/web/src/product/terminalSurface.test.tsx",
  "apps/web/src/product/terminalSurfaceTab.test.tsx",
  "apps/web/src/sidebarMetrics/sidebarAlignment.test.tsx",
  "apps/web/src/sidebarProjects/SidebarProjectsSection.test.tsx",
  "apps/web/src/sidebarProjects/newThreadShortcut.test.tsx",
  "apps/web/src/sidebarThreadRow/SidebarCompactThreadRow.test.tsx",
  "apps/web/src/sidebarThreadRow/SidebarThreadProjectIcons.test.tsx",
  "apps/web/src/sidebarThreadRow/ThreadStatusLabel.test.tsx",
  "packages/tasks-web/src/markdown/markdownEditorSession.test.ts",
];

const DOM_TEST_ENVIRONMENT_ALLOWLIST: Array<string> = [...UPCOMPUTER_LEGACY_DOM_TESTS];

const TEST_EXCLUDE = [
  "**/.repos/**",
  "**/.t3/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron/**",
  "**/.{idea,git,cache,output,temp}/**",
];

// Directories whose tests belong to a package's own test config. desktop also
// owns the kde-snap-shot tests through its `include`.
const TEST_CONFIG_PACKAGES = [
  "apps/desktop",
  "apps/mobile",
  "apps/server",
  "apps/web",
  "packages/client-runtime",
];

// `vp test run <file>` from the repo root hands each file to its package's
// config. Packages that borrow this config (`--config ../../vite.config.ts`) run
// from their own directory, as CI does, so they keep one plain project.
const isRepoRootTestRun = process.cwd() === import.meta.dirname;

const RESTRICTED_IMPORT_PATHS = [
  {
    name: "@t3tools/client-runtime",
    message:
      "Import from an explicit @t3tools/client-runtime/* subpath. The package has no root export.",
  },
  {
    name: "@pierre/diffs/react",
    importNames: ["CodeView"],
    message: "Use StyledDiffCodeView so web diff surfaces share styling and virtualized geometry.",
  },
  {
    name: "react-native-screens",
    importNames: ["ScrollViewMarker"],
    message:
      "Use NativeScrollViewMarker or NativeScrollView (src/native/NativeScrollViewMarker.tsx): they carry the header's scroll-edge blur under the Duo's vertical bar.",
  },
];

const RESTRICTED_UI_VARIANT_PATTERNS = [
  {
    group: ["**/components/ui/*", "**/ui/*", "./ui/*"],
    importNames: ["buttonVariants", "toggleVariants", "badgeVariants", "selectTriggerVariants"],
    message:
      "Render the components/ui export instead of borrowing its class recipe (render={<Button …/>}, SelectButton, ToggleGroup).",
  },
];

const RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS = {
  name: "lucide-react",
  importNames: [
    "GitMerge",
    "GitMergeIcon",
    "GitPullRequest",
    "GitPullRequestIcon",
    "GitPullRequestArrow",
    "GitPullRequestArrowIcon",
    "GitPullRequestClosed",
    "GitPullRequestClosedIcon",
    "GitPullRequestDraft",
    "GitPullRequestDraftIcon",
    "GitPullRequestCreate",
    "GitPullRequestCreateIcon",
    "GitPullRequestCreateArrow",
    "GitPullRequestCreateArrowIcon",
  ],
  message:
    "Pick a glyph by meaning from PullRequestGlyph in apps/web/src/components/pullRequest/pullRequestIcons.tsx so every surface draws the same pull request the same way.",
};

// Vite+ supports remote configuration before its published types include it.
const cacheUrl = remoteCacheUrl(import.meta.dirname);
const taskCacheConfig = {
  scripts: false,
  ...(cacheUrl ? { remote: { url: cacheUrl } } : {}),
};

export default defineConfig({
  run: {
    cache: taskCacheConfig,
    tasks: cachedTestTasks(process.env.T3_CACHED_TESTS),
  },
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Fixture subprocesses must not inherit the outer task runner’s cache policy.
    env: { VP_REMOTE_CACHE: "off", VP_REMOTE_CACHE_URL: "" },
    exclude: TEST_EXCLUDE,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    allowOnly: !process.env.CI,
    // Flaky tests are fixed, not retried.
    retry: 0,
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "Date",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
      ],
    },
    setupFiles: [
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/longTempDir.ts", import.meta.url),
      ),
      NodeURL.fileURLToPath(
        new URL("./packages/shared/src/testing/providerEnv.ts", import.meta.url),
      ),
    ],
    ...(isRepoRootTestRun
      ? {
          projects: [
            ...TEST_CONFIG_PACKAGES,
            {
              extends: true,
              test: {
                name: "root",
                exclude: [
                  ...TEST_EXCLUDE,
                  ...TEST_CONFIG_PACKAGES.map((dir) => `${dir}/**`),
                  "native/kde-snap-shot/**",
                ],
              },
            },
          ],
        }
      : {}),
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      ".repos/**",
      "infra/task-cache/vendor/**",
      // Macroscope requires one glob per line; Markdown formatting corrupts it.
      ".macroscope/ignore.md",
      ".alchemy",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/uniwind-types.d.ts",
      // Vendored and generated C.
      "apps/mobile/modules/t3-highlights/Vendor/**",
      "apps/mobile/modules/t3-highlights/cpp/generated/**",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: [
      ".repos",
      ".repos/**",
      "infra/task-cache/vendor/**",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/*.graphql.ts",
      "packages/source-control-github/schema/**",
      "apps/server/schema/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/uniwind-types.d.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-t3code/index.ts", "@shadcn/lint"],
    settings: {
      shadcn: { ui: "~/components/ui" },
    },
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "oxc/no-accumulating-spread": "error",
      "eslint/no-control-regex": "off",
      "typescript/no-this-alias": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-string-starts-ends-with": "off",
      "unicorn/prefer-set-has": "off",
      "unicorn/prefer-array-find": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-array-reverse": "off",
      "react/no-object-type-as-default-prop": "off",
      "react/jsx-no-constructed-context-values": "off",
      "react/memo-dependencies": "error",
      "react/purity": "error",
      "react/refs": "error",
      "react/exhaustive-effect-dependencies": "error",
      "react/set-state-in-effect": "error",
      "react/immutability": "error",
      "react/no-array-index-key": "error",
      "react/no-unstable-nested-components": "error",
      "react/static-components": "error",
      "react/capitalized-calls": "error",
      "typescript/no-extraneous-class": "error",
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "unicorn/no-useless-spread": "error",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "eslint/no-restricted-imports": [
        "error",
        { paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS] },
      ],
      "t3code/no-global-process-runtime": "error",
      "t3code/no-inline-schema-compile": "error",
      "t3code/no-low-value-comments": "error",
      "t3code/no-manual-effect-runtime-in-tests": "error",
      "t3code/no-native-title-tooltip": "error",
      // Test files only (the rule checks the filename).
      "t3code/no-polling-loop-in-tests": "error",
      "t3code/no-raw-mcp-registration": "error",
      "t3code/no-real-time-wait-in-tests": "error",
      "t3code/no-test-in-loop": "error",
      "t3code/no-test-timeout-or-unreasoned-skip": "error",
      "t3code/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }],
      "t3code/no-unscoped-has": "error",
      "t3code/no-wall-clock-in-tests": "error",
      "t3code/namespace-node-imports": "error",
      "t3code/prefer-catch-tags": "error",
      "t3code/prefer-effect-fn": "error",
      "t3code/require-centered-scroll-gutter": "error",
      "t3code/require-suppression-reason": "error",
    },
    overrides: [
      {
        files: [
          "**/*.{test,spec,testkit}.{ts,tsx}",
          "**/{test,tests,testkit,testing,fixtures,integration}/**",
          "packages/provider-testing/**",
        ],
        rules: { "t3code/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/web/**/*.test.{ts,tsx}"],
        excludeFiles: UPCOMPUTER_LEGACY_DOM_TESTS,
        rules: { "t3code/require-disposable-render": "error" },
      },
      {
        files: ["apps/web/src/**/*.browser.test.{ts,tsx}"],
        rules: { "t3code/no-frame-waits-in-browser-tests": "error" },
      },
      {
        // UpComputer burn-down list: our code written before upstream's comment-length
        // and React Compiler rules arrived in the 2026-10 sync. They stay at "warn" until
        // converted; remove a file when it passes. Do not add new files to this list.
        files: [
          "apps/desktop/src/app/DesktopCliCommand.ts",
          "apps/desktop/src/app/DesktopV1Upgrade.ts",
          "apps/desktop/src/window/UpcomputerWindowVibrancy.ts",
          "apps/marketing/src/scripts/horizon-backdrop.ts",
          "apps/marketing/src/scripts/story.ts",
          "apps/server/src/auth/RpcAuthorization.ts",
          "apps/server/src/cloud/RelayClock.ts",
          "apps/server/src/extensionApi.ts",
          "apps/server/src/linkedProjects/WorkspaceMcpTools.ts",
          "apps/server/src/linkedProjects/autoLinkProjects.ts",
          "apps/server/src/mcp/McpHttpServer.ts",
          "apps/server/src/orchestration-v2/OnboardingTurnNote.ts",
          "apps/server/src/orchestration-v2/Orchestrator.ts",
          "apps/server/src/orchestration-v2/linkedProjects.ts",
          "apps/server/src/persistence/CoreFeatureMigrations.ts",
          "apps/server/src/product/HttpRouteContribution.ts",
          "apps/server/src/product/ServerProduct.ts",
          "apps/server/src/upcomputerCutover/V1Cutover.ts",
          "apps/web/src/components/Sidebar.logic.ts",
          "apps/web/src/components/chat/MessagesTimeline.logic.ts",
          "apps/web/src/composerContextRow/ThreadHeaderProjects.tsx",
          "apps/web/src/composerContextRow/contextRowProjects.ts",
          "apps/web/src/composerContextRow/draftIntoAddedProject.ts",
          "apps/web/src/composerDraftStore.ts",
          "apps/web/src/composerFooter/ComposerFooterModelPicker.tsx",
          "apps/web/src/composerFooter/UpComputerComposerFooter.tsx",
          "apps/web/src/composerFooter/composerFooterMeasurement.ts",
          "apps/web/src/composerFooter/composerFooterSurface.ts",
          "apps/web/src/composerFooter/composerLookStyles.ts",
          "apps/web/src/onboardingSurface/FirstRunAgent.tsx",
          "apps/web/src/product/sidebarThreadClaims.ts",
          "apps/web/src/rightPanelStore.ts",
          "apps/web/src/sidebarMetrics/sidebarMetrics.ts",
          "apps/web/src/sidebarProjects/SidebarProjectRow.tsx",
          "apps/web/src/sidebarProjects/SidebarProjectsSection.tsx",
          "apps/web/src/sidebarThreadRow/SidebarCompactThreadRow.tsx",
          "apps/web/src/sidebarThreadRow/SidebarThreadProjectIcons.tsx",
          "apps/web/src/sidebarThreadRow/threadProjectIcons.logic.ts",
          "apps/web/src/sidebarVibrancy/hiddenBrowserBackdrop.ts",
          "apps/web/src/sidebarVibrancy/sidebarVibrancy.ts",
          "apps/web/src/state/workspace.ts",
          "infra/relay/scripts/generate-vapid-keys.ts",
          "infra/relay/src/agentActivity/Devices.ts",
          "packages/computer-use-server/src/settings/ComputerUseSettingsFile.ts",
          "packages/computer-use-web/src/settings/BrowserUseSettingsPage.tsx",
          "packages/computer-use-web/src/settings/ComputerUseSettingsPage.tsx",
          "packages/contracts/src/defaultCustomInstructions.ts",
          "packages/contracts/src/orchestrationV2.ts",
          "packages/contracts/src/relay.ts",
          "packages/provider-core/src/server/mcpSession.ts",
          "packages/provider-core/src/server/userInstructions.ts",
          "packages/provider-opencode/src/server/adapter.ts",
          "packages/provider-opencode/src/server/driver.ts",
          "packages/provider-opencode/src/server/status.ts",
          "packages/shared/src/devHome.ts",
          "packages/shared/src/git.ts",
          "packages/shared/src/productFlags.ts",
          "packages/shared/src/serverSettings.ts",
          "packages/shared/src/shell.ts",
          "packages/shared/src/upcomputerIdentity.ts",
          "packages/shared/src/upcomputerTheme.ts",
          "packages/tasks-contracts/src/v1/automations.ts",
          "packages/tasks-contracts/src/v1/prompts.ts",
          "packages/tasks-contracts/src/v1/tasks.ts",
          "packages/tasks-server/src/agents/TaskAgentService.ts",
          "packages/tasks-server/src/agents/TaskAgentService.v2.integration.test.ts",
          "packages/tasks-server/src/agents/TaskSourceWake.ts",
          "packages/tasks-server/src/context/AgentQueues.ts",
          "packages/tasks-server/src/import/WandeImport.ts",
          "packages/tasks-server/src/mcp/TaskMcpTools.ts",
          "packages/tasks-server/src/persistence/TaskRepository.ts",
          "packages/tasks-server/src/persistence/migrations/012_TaskTriggerSemantics.ts",
          "packages/tasks-server/src/persistence/migrations/020_TaskAudienceAndKind.ts",
          "packages/tasks-server/src/persistence/migrations/021_TaskScheduleEntries.ts",
          "packages/tasks-server/src/persistence/migrations/024_TaskAutomationRank.ts",
          "packages/tasks-server/src/persistence/migrations/031_TasksNewestFirst.ts",
          "packages/tasks-server/src/schedule/followTaskState.ts",
          "packages/tasks-server/src/tools/TaskToolService.ts",
          "packages/tasks-web/src/markdown/MarkdownEditor.tsx",
          "packages/tasks-web/src/markdown/markdownEditorCore.ts",
          "packages/tasks-web/src/markdown/markdownFormat.ts",
          "packages/tasks-web/src/planner/data/automationStore.ts",
          "packages/tasks-web/src/planner/data/pendingOps.ts",
          "packages/tasks-web/src/planner/data/plannerStore.ts",
          "packages/tasks-web/src/planner/logic/dndPlanning.ts",
          "packages/tasks-web/src/planner/logic/handOff.ts",
          "packages/tasks-web/src/planner/logic/plannerWidth.ts",
          "packages/tasks-web/src/planner/reminders/TaskReminderNotifications.tsx",
          "packages/tasks-web/src/planner/ui/FloatingWindow.tsx",
          "packages/tasks-web/src/planner/ui/PlannerLayout.tsx",
          "packages/tasks-web/src/planner/ui/PlannerView.tsx",
          "packages/tasks-web/src/planner/ui/RunSummary.tsx",
          "packages/tasks-web/src/planner/ui/plannerContext.ts",
          "packages/tasks-web/src/planner/ui/tasksViewGate.ts",
          "packages/tasks-web/src/planner/windows/windowStore.ts",
          "packages/tasks-web/src/settings/InstructionsSettingsPage.tsx",
          "packages/tasks-web/src/ui/AgentsView.tsx",
          "packages/tasks-web/src/ui/DetailSidebar.tsx",
          "packages/tasks-web/src/ui/TagChipsField.tsx",
          "packages/tasks-web/src/ui/TaskNavigationRunCounts.tsx",
          "packages/tasks-web/src/ui/TasksRoute.tsx",
          "packages/tasks-web/src/ui/TasksView.tsx",
          "packages/tasks-web/src/ui/WorkspaceViewLayout.tsx",
          "packages/tasks-web/src/ui/projectFilter.ts",
          "packages/tasks-web/src/ui/usePagesProjectFilter.ts",
          "packages/tasks-web/src/ui/useTaskPages.ts",
          "packages/tasks-web/src/ui/useWorkspaceData.ts",
          "scripts/check-branding.ts",
        ],
        rules: {
          "t3code/no-low-value-comments": "warn",
          "react/exhaustive-effect-dependencies": "warn",
          "react/memo-dependencies": "warn",
          "react/refs": "warn",
          "react/set-state-in-effect": "warn",
        },
      },
      {
        // UpComputer burn-down list: our tests written before upstream's test-timing
        // rules arrived in the 2026-10 sync. They stay at "warn" until converted;
        // remove a file when it passes. Do not add new files to this list.
        files: [
          "apps/desktop/src/backend/DesktopBackendQuit.test.ts",
          "apps/web/src/composerFooter/composerLookChromium.test.tsx",
          "apps/web/src/product/tasksSurface.test.tsx",
          "apps/web/src/sidebarMetrics/sidebarAlignment.test.tsx",
          "apps/web/src/sidebarThreadRow/SidebarCompactThreadRow.test.tsx",
          "apps/web/src/sidebarThreadRow/SidebarThreadProjectIcons.test.tsx",
          "apps/web/src/sidebarThreadRow/ThreadStatusLabel.test.tsx",
          "apps/web/src/sidebarVibrancy/sidebarVibrancy.test.tsx",
          "packages/computer-use-server/src/computerUse/ComputerUseNativeContract.test.ts",
          "packages/tasks-server/src/agents/TaskAgentService.v2.integration.test.ts",
          "packages/tasks-server/src/agents/TaskTriggerSemantics.test.ts",
          "packages/tasks-server/src/tools/InstructionsTools.test.ts",
          "packages/tasks-web/src/bots/botAutosave.test.ts",
          "packages/tasks-web/src/environmentApi.test.ts",
          "packages/tasks-web/src/planner/data/automationStore.test.ts",
          "packages/tasks-web/src/planner/data/plannerStore.test.ts",
          "packages/tasks-web/src/ui/environmentRunCounts.test.ts",
          "packages/tasks-web/src/ui/taskLiveUpdates.test.ts",
          "packages/tasks-web/src/ui/tasksPanelCache.test.ts",
          "packages/tasks-web/src/ui/threadRunCounts.test.ts",
        ],
        rules: {
          "t3code/no-polling-loop-in-tests": "warn",
          "t3code/no-real-time-wait-in-tests": "warn",
          "t3code/no-test-timeout-or-unreasoned-skip": "warn",
          "t3code/no-wall-clock-in-tests": "warn",
        },
      },
      {
        files: ["apps/**/src/**", "packages/**/src/**"],
        excludeFiles: DOM_TEST_ENVIRONMENT_ALLOWLIST,
        rules: { "t3code/no-dom-test-environment": "error" },
      },
      {
        files: ["packages/client-runtime/src/state/**", "apps/{web,mobile,desktop}/src/**"],
        rules: { "t3code/no-rpc-permission-bypass": ["error", { allowRawClientAccess: false }] },
      },
      {
        files: [
          "packages/client-runtime/src/state/runtime.ts",
          "packages/client-runtime/src/state/vcsAction.ts",
        ],
        rules: {
          "t3code/no-rpc-permission-bypass": [
            "error",
            { allowGuardInstallation: true, allowRawClientAccess: false },
          ],
        },
      },
      {
        files: [
          "apps/web/src/components/settings/AuthorizedClientsSettings.tsx",
          "apps/mobile/src/features/updates/app-updates.ts",
          "apps/web/src/components/device/DevicePhoneViewport.tsx",
          "apps/web/src/components/device/DeviceDuoViewport.tsx",
        ],
        rules: { "t3code/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }] },
      },
      {
        // Product feature RPC groups are not core methods; the server authorizes them by the
        // scopes each feature declares (`rpcContributionScopes`).
        files: ["apps/web/src/product/FeatureRpc.ts"],
        rules: { "t3code/no-rpc-permission-bypass": ["error", { allowRawClientAccess: true }] },
      },
      {
        files: ["packages/client-runtime/src/connection/outdatedHostUpdate.ts"],
        rules: { "t3code/no-rpc-permission-bypass": "off" },
      },
      {
        files: [
          "packages/client-runtime/src/rpc/**",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "t3code/no-rpc-permission-bypass": "off" },
      },
      {
        files: ["packages/shared/src/HostProcess.ts"],
        rules: { "t3code/no-global-process-runtime": "off" },
      },
      {
        // The `t3` npm launcher is published as plain, dependency-free Node.
        files: ["scripts/npm-launcher/**"],
        rules: {
          "t3code/no-global-process-runtime": "off",
          "t3code/namespace-node-imports": "off",
        },
      },
      {
        files: ["apps/server/src/mcp/McpHttpServer.ts"],
        rules: { "t3code/no-raw-mcp-registration": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: RESTRICTED_UI_VARIANT_PATTERNS,
            },
          ],
        },
      },
      {
        files: ["apps/web/src/components/pullRequest/pullRequestIcons.tsx"],
        rules: { "eslint/no-restricted-imports": ["error", { paths: RESTRICTED_IMPORT_PATHS }] },
      },
      {
        // The server and every client load a forge's shared definition, so a UI runtime
        // imported there would break the server; client-only forge code goes in `src/client/`.
        files: ["packages/source-control-*/src/shared/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: [
                {
                  group: [
                    "react",
                    "react/*",
                    "react-*",
                    "expo",
                    "expo-*",
                    "lucide-react",
                    "@t3tools/client-runtime",
                    "@t3tools/client-runtime/*",
                    "../client/*",
                    "../server/*",
                    "../../client/*",
                    "../../server/*",
                    "../../../client/*",
                    "../../../server/*",
                    "@t3tools/source-control-*/client/*",
                    "@t3tools/source-control-*/server/*",
                  ],
                  message:
                    "Shared forge definitions load on the server and every client; keep UI and server code out.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/server/src/**", "packages/source-control-*/src/server/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            {
              paths: [...RESTRICTED_IMPORT_PATHS, RESTRICTED_PULL_REQUEST_GLYPH_IMPORTS],
              patterns: [
                {
                  group: [
                    "@t3tools/source-control-*/client/*",
                    "../client/*",
                    "../../client/*",
                    "../../../client/*",
                  ],
                  message:
                    "A forge's client entry is UI-only; the server reads its `shared/definition`.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["apps/mobile/src/**"],
        rules: {
          "t3code/no-mobile-uniwind-theme-escape-hatches": "error",
          "t3code/require-registered-list-scroll": "error",
        },
      },
      {
        files: ["apps/mobile/src/**"],
        excludeFiles: [
          "apps/mobile/src/components/ui/AppSymbol.tsx",
          "apps/mobile/src/components/ui/AppSymbol.ios.tsx",
          "apps/mobile/src/features/pull-requests/pullRequestGlyphs.ts",
        ],
        rules: { "t3code/no-mobile-pull-request-glyph-literals": "error" },
      },
      {
        files: ["apps/mobile/src/**"],
        excludeFiles: ["**/*.test.{ts,tsx}"],
        rules: { "t3code/no-ambiguous-detail-navigation": "error" },
      },
      {
        // Raw ResizeObserver state commits miss the paint; observeResize flushes derived layout together.
        files: ["apps/web/src/**"],
        excludeFiles: [
          "apps/web/src/lib/observeResize.ts",
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
        ],
        rules: { "t3code/no-raw-resize-observer": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-unknown-classes": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "t3code/no-outset-state-indicators": "error" },
      },
      {
        files: ["apps/*/src/**", "packages/*/src/**"],
        excludeFiles: [
          "**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts,mjs,cjs}",
          "**/testkit/**",
          "**/_generated/**",
          // Real user quotes stay verbatim.
          "apps/marketing/src/lib/tweets.ts",
        ],
        rules: { "t3code/no-em-dash-copy": "error" },
      },
      {
        files: ["apps/web/src/**"],
        rules: { "shadcn/no-raw-colors": "error" },
      },
      {
        // Third-party marks must retain their exact colors.
        files: ["apps/web/src/components/Icons.tsx", "apps/web/src/components/JetBrainsIcons.tsx"],
        rules: { "shadcn/no-raw-colors": "off" },
      },
      {
        files: ["apps/web/src/**"],
        excludeFiles: ["apps/web/src/components/ui/**"],
        rules: {
          "shadcn/require-static-classes": "error",
          "shadcn/no-arbitrary-values": [
            "error",
            {
              allow: [
                "layout",
                "transition",
                "rounded-[inherit]",
                "gap-[0.33em]",
                "gap-[0.2em]",
                "leading-[normal]",
                "underline-offset-[0.2em]",
                "rounded-[25%]",
                "text-[length:80cqh]",
                "bg-[Highlight]",
                "fill-[#26251E]",
                "fill-[#EDECEC]",
                "fill-[#0F0F0F]",
                "fill-[#F5F5F5]",
                "fill-[#d97757]",
                "text-[#d97757]",
              ],
            },
          ],
          "shadcn/no-restyle": [
            "error",
            {
              allow: ["layout"],
              contracts: [
                {
                  // CollapsibleTrigger has no styled counterpart; other triggers use render={<Button …/>}.
                  pattern: "^CollapsibleTrigger$",
                  allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
                },
              ],
            },
          ],
        },
      },
      {
        // React Compiler owns memoization; upstream rules do not ban redundant useMemo/useCallback.
        files: ["apps/web/src/**/*.{ts,tsx}"],
        rules: {
          "react/exhaustive-effect-dependencies": "error",
          "react/globals": "error",
          "react/hooks": "error",
          "react/immutability": "error",
          // The compiler memoizes context values; this rule would ask for useMemo.
          "react/jsx-no-constructed-context-values": "off",
          "react/memo-dependencies": "error",
          "react/preserve-manual-memoization": "error",
          // Render-time clock reads use @t3tools/client-runtime/clock or state seeded with the
          // time; any other read carries a suppression that says why. oxlint also flags time reads
          // inside event handlers (oxc#27309); those suppressions cite it.
          "react/purity": "error",
          "react/refs": "error",
          "react/set-state-in-effect": "error",
          "react/set-state-in-render": "error",
          "react/static-components": "error",
          "react/unsupported-syntax": "error",
          "t3code/no-manual-memo": "error",
        },
      },
      {
        // ESNext types allow APIs absent from Hermes; restrict shared client code, exempting Node tests.
        files: [
          "apps/mobile/src/**",
          "packages/client-runtime/src/**",
          "packages/contracts/src/**",
          "packages/shared/src/**",
        ],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "t3code/no-hermes-unsupported-apis": "error" },
      },
      {
        // Directives hide bailouts from mobile's compiler-coverage check; retain hooks until its allowlist is empty.
        files: ["apps/mobile/src/**/*.{ts,tsx}"],
        rules: { "t3code/no-manual-memo": ["error", { allowMemoHooks: true }] },
      },
      {
        files: ["apps/web/src/**", "apps/mobile/src/**", "packages/*/src/**"],
        rules: { "t3code/no-unreasoned-state-sync": "error" },
      },
      {
        // React Compiler caches use* functions only if they call a hook.
        files: ["apps/web/src/**/*.{ts,tsx}", "apps/mobile/src/**/*.{ts,tsx}"],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: { "t3code/no-hookless-use-function": "error" },
      },
      {
        files: [
          "apps/mobile/src/features/archive/ArchivedThreadsScreen.tsx",
          "apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx",
          "apps/mobile/src/features/files/FileMarkdownPreview.tsx",
          "apps/mobile/src/features/files/SourceFileSurface.tsx",
          "apps/mobile/src/features/files/AttachmentFileScreen.tsx",
          "apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx",
          "apps/mobile/src/features/files/thread-file-navigator-pane.tsx",
          "apps/mobile/src/features/review/ReviewSheet.tsx",
          "apps/mobile/src/features/review/useNativeReviewDiffBridge.ts",
          "apps/mobile/src/features/settings/SettingsEnvironmentsRouteScreen.tsx",
          "apps/mobile/src/features/threads/ThreadComposer.tsx",
          "apps/mobile/src/features/threads/ThreadFeed.tsx",
          "apps/mobile/src/features/threads/ThreadQueueControl.tsx",
          "apps/mobile/src/features/review/ReviewCommentCard.tsx",
          "apps/mobile/src/features/threads/ThreadSettingsSheet.tsx",
          "apps/mobile/src/features/threads/thread-list-v2-items.tsx",
          "apps/mobile/src/lib/useMobileNavigationTheme.ts",
          "apps/mobile/src/native/T3ComposerEditor.ios.tsx",
          "apps/mobile/src/native/T3ComposerEditor.native.tsx",
          "apps/mobile/src/native/SelectableMarkdownText.tsx",
          "apps/mobile/src/native/useEnrichedLinkVariants.ts",
        ],
        rules: {
          "t3code/no-mobile-uniwind-theme-escape-hatches": ["error", { allowUniwindTheme: true }],
        },
      },
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
