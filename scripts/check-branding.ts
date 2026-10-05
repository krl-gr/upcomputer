// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A plain file check that CI and upstream syncs run.
/**
 * Fails when the Up.computer identity or copy regressed to upstream's T3
 * values, typically after a merge from upstream. Run after every sync:
 *
 *   node scripts/apply-branding.ts   # rewrites T3 copy that came back
 *   node scripts/check-branding.ts   # everything else needs a manual fix
 *
 * See docs/branding.md.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  BRANDING_REGISTRY,
  isCopyFile,
  listTrackedFiles,
  rebrandLine,
  UPCOMPUTER_POSTHOG_PROJECT_KEY_SHA256,
} from "./lib/branding.ts";

const REQUIRED_FILES = [
  "assets/prod/upcomputer-macos-1024.png",
  "assets/prod/upcomputer-windows.ico",
  "assets/prod/upcomputer-universal-1024.png",
  "assets/dev/upcomputer-blueprint-macos-1024.png",
  "docs/branding.md",
  "docs/operations/upcomputer-connect-setup.md",
] as const;

export function findBrandingProblems(
  repoRoot: string,
  trackedFiles: ReadonlyArray<string> = listTrackedFiles(repoRoot),
): ReadonlyArray<string> {
  const problems: string[] = [];
  const read = (path: string): string | undefined => {
    const absolutePath = NodePath.join(repoRoot, path);
    return NodeFS.existsSync(absolutePath) ? NodeFS.readFileSync(absolutePath, "utf8") : undefined;
  };

  for (const entry of BRANDING_REGISTRY) {
    const text = read(entry.path);
    if (text === undefined) {
      problems.push(`${entry.path}: file is missing`);
      continue;
    }
    for (const required of entry.requires ?? []) {
      if (!text.includes(required)) problems.push(`${entry.path}: missing ${required}`);
    }
    for (const forbidden of entry.forbids ?? []) {
      if (text.includes(forbidden)) problems.push(`${entry.path}: contains upstream ${forbidden}`);
    }
  }

  for (const path of REQUIRED_FILES) {
    if (!NodeFS.existsSync(NodePath.join(repoRoot, path))) {
      problems.push(`${path}: file is missing`);
    }
  }

  const analytics = read("apps/server/src/telemetry/AnalyticsService.ts") ?? "";
  const posthogKey = /UPCOMPUTER_POSTHOG_PROJECT_KEY = "([^"]+)"/.exec(analytics)?.[1] ?? "";
  if (
    NodeCrypto.createHash("sha256").update(posthogKey).digest("hex") !==
    UPCOMPUTER_POSTHOG_PROJECT_KEY_SHA256
  ) {
    problems.push(
      "apps/server/src/telemetry/AnalyticsService.ts: the PostHog key is not V1's Up.computer project key",
    );
  }

  for (const path of trackedFiles.filter(isCopyFile)) {
    const text = read(path);
    if (text === undefined) continue;
    text.split("\n").forEach((line, index) => {
      if (rebrandLine(line, path) !== line) {
        problems.push(`${path}:${index + 1}: T3 copy; run node scripts/apply-branding.ts`);
      }
    });
  }

  return problems;
}

if (import.meta.main) {
  const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
  const problems = findBrandingProblems(repoRoot);
  if (problems.length > 0) {
    console.error(`check-branding: ${problems.length} problem(s). See docs/branding.md.`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("check-branding: the Up.computer identity and copy are intact.");
  }
}
