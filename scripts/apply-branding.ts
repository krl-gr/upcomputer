// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A plain file pass over the working tree that reports what it changed.
/**
 * Rewrites user-visible T3 copy to Up.computer. Idempotent: run it after a
 * merge from upstream, then `node scripts/check-branding.ts`.
 *
 *   node scripts/apply-branding.ts
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { isCopyFile, listTrackedFiles, rebrandText } from "./lib/branding.ts";

const repoRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

let changed = 0;
for (const path of listTrackedFiles(repoRoot).filter(isCopyFile)) {
  const absolutePath = NodePath.join(repoRoot, path);
  if (!NodeFS.existsSync(absolutePath)) continue;
  const text = NodeFS.readFileSync(absolutePath, "utf8");
  const rebranded = rebrandText(text, path);
  if (rebranded === text) continue;
  NodeFS.writeFileSync(absolutePath, rebranded);
  changed += 1;
  console.log(`rebranded ${path}`);
}
console.log(`apply-branding: ${changed} file(s) changed.`);
