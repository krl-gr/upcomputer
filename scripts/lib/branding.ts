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
