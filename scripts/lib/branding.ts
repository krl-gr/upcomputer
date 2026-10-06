// @effect-diagnostics nodeBuiltinImport:off - Branding scripts are plain file passes run before and after upstream merges.
import * as NodeChildProcess from "node:child_process";

/**
 * Up.computer's thin branding: user-visible copy says Up.computer, internal
 * names stay upstream's. `scripts/apply-branding.ts` rewrites the copy and
 * `scripts/check-branding.ts` fails when a merge brings T3 copy back.
 * See docs/branding.md.
 */

export interface CopyRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

export const COPY_RULES: ReadonlyArray<CopyRule> = [
  { pattern: /\bT3 Code\b/g, replacement: "Up.computer" },
  { pattern: /\b(a|A) Up\.computer\b/g, replacement: "$1n Up.computer" },
  { pattern: /\ba T3 thread\b/g, replacement: "an Up.computer thread" },
  { pattern: /\bT3 (thread|threads|server|home)\b/g, replacement: "Up.computer $1" },
  { pattern: /\bT3 Connect\b/g, replacement: "UpComputer Connect" },
  // The HTML render tools and their errors, which agents read and repeat to the user.
  {
    pattern:
      /\bT3('s (?:headless browser|home directory)| (?:is (?:still )?installing|could not install|fits the frame|injects its)\b)/g,
    replacement: "Up.computer$1",
  },
  // Markdown links to the site. Other t3.codes URLs are upstream's schemas,
  // install scripts and test data.
  { pattern: /\]\(https:\/\/t3\.codes\)/g, replacement: "](https://up.computer)" },
];

const COPY_ROOTS = [
  "apps/web/src/",
  "apps/web/index.html",
  "apps/desktop/src/",
  "apps/desktop/scripts/",
  "apps/server/src/",
  "packages/",
  // Push notification and Live Activity text from the Connect relay. The rest
  // of infra/relay runs as upstream ships it.
  "infra/relay/src/agentActivity/",
] as const;

const COPY_EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|html)$/;

/**
 * Files whose T3 text is not ours to rebrand: upstream's issue triage tool
 * files reports against upstream, and the relay contract follows upstream's
 * relay, which Up.computer runs as is.
 */
const COPY_EXCLUDED = [
  /^apps\/server\/src\/cli\/triage/,
  /^packages\/contracts\/src\/relay\.ts$/,
  /\/fixtures\//,
  /\/node_modules\//,
] as const;

export function isCopyFile(path: string): boolean {
  return (
    COPY_ROOTS.some((root) => path === root || path.startsWith(root)) &&
    COPY_EXTENSIONS.test(path) &&
    !COPY_EXCLUDED.some((pattern) => pattern.test(path))
  );
}

// Comments describe upstream code and stay as upstream wrote them, which also
// keeps them out of merge conflicts.
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

/**
 * Lines that carry protocol identity rather than copy. The MCP server's
 * `serverInfo` name is what agents echo back as a tool-name prefix, and the
 * tool presentation parser recognizes upstream's spelling of it.
 */
const KEEP_LINES: ReadonlyArray<{ readonly path: RegExp; readonly line: RegExp }> = [
  { path: /^apps\/server\/src\/mcp\/McpHttpServer\.ts$/, line: /^\s*name: "T3 Code",$/ },
  // Codex app-server `clientInfo`; the Codex replay fixtures pin it.
  {
    path: /^apps\/server\/src\/provider\/Layers\/CodexProvider\.ts$/,
    line: /^\s*(name|title): "T3 Code",$/,
  },
  {
    path: /^apps\/server\/src\/orchestration-v2\/Adapters\/CodexAdapterV2\.test\.ts$/,
    line: /clientInfo: \{ name: "T3 Code"|userAgent: "T3 Code\//,
  },
  // Output of the ACP mock agent (apps/server/scripts), which is test data.
  {
    path: /^apps\/server\/src\/orchestration-v2\/Adapters\/AcpAdapterV2\.test\.ts$/,
    line: /snippet: "T3 Code page"/,
  },
  {
    path: /^packages\/shared\/src\/t3McpToolPresentation\.test\.ts$/,
    line: /^\s*"T3 Code( delegate_task)? ?",$/,
  },
];

export function rebrandLine(line: string, path = ""): string {
  if (COMMENT_LINE.test(line)) return line;
  if (KEEP_LINES.some((keep) => keep.path.test(path) && keep.line.test(line))) return line;
  return COPY_RULES.reduce((text, rule) => text.replace(rule.pattern, rule.replacement), line);
}

export function rebrandText(text: string, path = ""): string {
  return text
    .split("\n")
    .map((line) => rebrandLine(line, path))
    .join("\n");
}

export function listTrackedFiles(repoRoot: string): ReadonlyArray<string> {
  return NodeChildProcess.execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((path) => path.length > 0);
}

/**
 * Every place that sets the Up.computer identity, with the text that must be
 * there and the upstream text that must not come back. docs/branding.md
 * explains each entry; `scripts/check-branding.ts` enforces them.
 */
export interface BrandingRegistryEntry {
  readonly path: string;
  readonly requires?: ReadonlyArray<string>;
  readonly forbids?: ReadonlyArray<string>;
}

export const BRANDING_REGISTRY: ReadonlyArray<BrandingRegistryEntry> = [
  // Identity values, all from V1.
  {
    path: "packages/shared/src/upcomputerIdentity.ts",
    requires: [
      'UPCOMPUTER_PRODUCT_NAME = "Up.computer"',
      'UPCOMPUTER_APP_ID = "computer.up.upcomputer"',
      'UPCOMPUTER_DESKTOP_PRODUCT_NAME = "Up.computer (Alpha)"',
      'UPCOMPUTER_NIGHTLY_DESKTOP_PRODUCT_NAME = "Up.computer (Nightly)"',
      'UPCOMPUTER_USER_DATA_DIR_NAME = "Up.computer"',
      'UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME = "Up.computer (Dev)"',
      'UPCOMPUTER_PROTOCOL_SCHEME = "upcomputer"',
      'UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME = "upcomputer-dev"',
      'UPCOMPUTER_EXECUTABLE_NAME = "upcomputer"',
      'UPCOMPUTER_HOME_DIRECTORY_NAME = ".upcomputer"',
      'UPCOMPUTER_UPDATE_REPOSITORY = "krl-gr/upcomputer"',
      'UPCOMPUTER_SITE_URL = "https://up.computer"',
      'UPCOMPUTER_LOCAL_TEST_APP_NAME = "UpComputer Local Test"',
      'UPCOMPUTER_LOCAL_TEST_APP_ID = "computer.up.upcomputer.localtest"',
      'UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME = ".upcomputer-local-test"',
    ],
  },
  { path: "apps/desktop/package.json", requires: ['"productName": "Up.computer (Alpha)"'] },
  {
    path: "apps/desktop/src/app/DesktopEnvironment.ts",
    requires: ["APP_BASE_NAME = UPCOMPUTER_PRODUCT_NAME", "UPCOMPUTER_APP_ID"],
    forbids: ['"com.t3tools.t3code', '"T3 Code"'],
  },
  {
    path: "apps/desktop/src/app/DesktopEarlyElectronStartup.ts",
    requires: ["UPCOMPUTER_APP_ID", "UPCOMPUTER_EXECUTABLE_NAME"],
    forbids: ["com.t3tools.T3Code", '"t3code"'],
  },
  {
    path: "apps/desktop/src/app/DesktopStatePaths.ts",
    requires: ["UPCOMPUTER_HOME_DIRECTORY_NAME"],
    forbids: ['".t3"'],
  },
  {
    path: "apps/desktop/src/app/DesktopUserData.ts",
    requires: ["UPCOMPUTER_USER_DATA_DIR_NAME", "UPCOMPUTER_DEVELOPMENT_USER_DATA_DIR_NAME"],
    forbids: ['"t3code-v2"', '"t3code-dev"', '"T3 Code (Alpha)"'],
  },
  {
    path: "apps/desktop/src/app/UpcomputerStartupEnvironment.ts",
    requires: ["applyUpcomputerEnvAliases(env)", "UPCOMPUTER_LOCAL_TEST_HOME_DIRECTORY_NAME"],
  },
  {
    path: "apps/desktop/src/main.ts",
    requires: ['import "./app/UpcomputerStartupEnvironmentEffect.ts";'],
  },
  {
    path: "apps/desktop/src/electron/ElectronProtocol.ts",
    requires: ["UPCOMPUTER_PROTOCOL_SCHEME", "UPCOMPUTER_DEVELOPMENT_PROTOCOL_SCHEME"],
    forbids: ['"t3code"', '"t3code-dev"'],
  },
  {
    path: "apps/desktop/src/app/DesktopAssets.ts",
    requires: ['"upcomputer-windows.ico"', '"upcomputer-blueprint-windows.ico"'],
    forbids: ['"t3-black-windows.ico"'],
  },
  {
    path: "apps/desktop/scripts/electron-launcher.mjs",
    requires: ['"computer.up.upcomputer"', '["upcomputer"]', '"Up.computer (Alpha)"'],
    forbids: ["com.t3tools", '["t3code"]', '"black-macos-1024.png"'],
  },
  {
    path: "scripts/build-desktop-artifact.ts",
    requires: [
      "DESKTOP_APP_ID = UPCOMPUTER_APP_ID",
      "resolveDesktopAppId(version)",
      '"Up.computer-${version}-${arch}.${ext}"',
      "name: UPCOMPUTER_EXECUTABLE_NAME",
      "executableName: UPCOMPUTER_EXECUTABLE_NAME",
      "protocols: resolveDesktopProtocols(version)",
      "hasMacPasskeySigningConfiguration(releaseEnv)",
      "applyUpcomputerEnvAliases(process.env)",
    ],
    forbids: ['"com.t3tools.t3code"', '"T3-Code-', 'schemes: ["t3code"', '"T3 Tools"'],
  },
  {
    path: "scripts/lib/brand-assets.ts",
    requires: ["assets/prod/upcomputer-macos-1024.png", "assets/dev/upcomputer-blueprint-"],
    forbids: ['"assets/prod/black-', '"assets/prod/t3-black-', '"assets/nightly/nightly-'],
  },
  {
    path: "scripts/resolve-previous-release-tag.ts",
    requires: ["(core-)?v", 'namespace: corePrefix ? "core" : "official"'],
  },
  { path: "scripts/dev-runner.ts", requires: ["UPCOMPUTER_HOME_DIRECTORY_NAME"] },
  // Schemes, home, hosted URL and branch names shared by server and clients.
  {
    path: "apps/server/src/http.ts",
    requires: ["UPCOMPUTER_PROTOCOL_SCHEME"],
    forbids: ['"t3code://app"'],
  },
  {
    path: "apps/server/src/os-jank.ts",
    requires: ["UPCOMPUTER_HOME_DIRECTORY_NAME"],
    forbids: ['homedir(), ".t3")'],
  },
  {
    path: "packages/shared/src/devHome.ts",
    requires: ["UPCOMPUTER_HOME_DIRECTORY_NAME"],
    forbids: ['worktreePath, ".t3")'],
  },
  {
    path: "packages/shared/src/codexAuthHandoff.ts",
    requires: ["UPCOMPUTER_PROTOCOL_SCHEME"],
    forbids: ['"t3code:"', '"t3code-dev"'],
  },
  {
    path: "packages/shared/src/providerAuthReturnUrl.ts",
    requires: ["UPCOMPUTER_PROTOCOL_SCHEME"],
    forbids: ['"t3code:"', '"https://app.t3.codes"'],
  },
  {
    path: "packages/shared/src/connectAuth.ts",
    requires: ["DEFAULT_HOSTED_APP_URL = UPCOMPUTER_SITE_URL"],
  },
  {
    path: "packages/shared/src/cliRelease.ts",
    requires: ["CLI_RELEASE_REPOSITORY = UPCOMPUTER_UPDATE_REPOSITORY"],
  },
  { path: "packages/shared/src/git.ts", requires: ['WORKTREE_BRANCH_PREFIX = "upcomputer"'] },
  {
    path: "packages/contracts/src/settings.ts",
    requires: [
      'branchNamePrefix: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed("upcomputer")))',
    ],
  },
  {
    path: "apps/server/src/telemetry/AnalyticsService.ts",
    requires: ["Config.withDefault(UPCOMPUTER_POSTHOG_PROJECT_KEY)"],
  },
  // UPCOMPUTER_* environment aliases at the entry points.
  { path: "apps/server/src/bin.ts", requires: ["applyUpcomputerEnvAliases(process.env)"] },
  { path: "apps/server/src/binCli.ts", requires: ["applyUpcomputerEnvAliases(process.env)"] },
  { path: "scripts/lib/public-config.ts", requires: ["applyUpcomputerEnvAliases("] },
  // Web shell.
  { path: "apps/web/src/branding.ts", requires: ["UPCOMPUTER_PRODUCT_NAME"] },
  { path: "apps/web/index.html", requires: ["<title>Up.computer (Alpha)</title>"] },
  { path: "apps/web/public/manifest.webmanifest", requires: ['"name": "Up.computer"'] },
  {
    path: "apps/web/src/components/T3Wordmark.tsx",
    requires: ['href="/apple-touch-icon.png"'],
  },
  { path: "apps/web/src/components/sidebar/SidebarChrome.tsx", requires: ["{APP_BASE_NAME}"] },
  { path: "apps/web/src/components/onboarding/WelcomeWizard.tsx", requires: ["{APP_BASE_NAME}"] },
  {
    path: "apps/web/src/components/desktopUpdate.logic.ts",
    requires: ["UPCOMPUTER_UPDATE_REPOSITORY", '"core-v"'],
    forbids: ["pingdotgg/t3code"],
  },
  // Packaging artwork and copy outside the codemod's scope.
  { path: "apps/desktop/resources/dmg/dmg-background-latest.svg", forbids: ["T3 Code"] },
  { path: "apps/desktop/resources/dmg/dmg-background-nightly.svg", forbids: ["T3 Code"] },
  { path: ".gitignore", requires: [".upcomputer"] },
  { path: ".env.example", forbids: ["relay.t3.codes", "T3CODE_CLERK_PUBLISHABLE_KEY=pk_"] },
  // Release and Connect workflows.
  {
    path: ".github/workflows/release.yml",
    requires: ['echo "tag=core-v$version"', "--filter @t3tools/desktop ensure:electron"],
    forbids: ["blacksmith-", "app.t3.codes"],
  },
  {
    path: ".github/workflows/deploy-relay.yml",
    requires: ["vars.RELAY_DOMAIN != ''", "name: Deploy UpComputer Connect relay"],
    forbids: ["runs-on: blacksmith-"],
  },
];

/** SHA-256 of V1's Up.computer PostHog project key, so a merge cannot swap it silently. */
export const UPCOMPUTER_POSTHOG_PROJECT_KEY_SHA256 =
  "ce0556183b3576c308c7bbfb98609c2490a01cdd7ec27053bf2771ac6330a4ae";
