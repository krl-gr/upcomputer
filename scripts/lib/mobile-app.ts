// @effect-diagnostics nodeBuiltinImport:off - Vite loads this before dependency installation and service initialization.
// apps/mobile is upstream's app and outside our pnpm workspace (pnpm-workspace.yaml), so
// `vp i` leaves it without node_modules, and its vite.config.ts cannot load without them.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const MOBILE_SKIPPED = "apps/mobile skipped: its dependencies are not installed";

export const mobileDepsInstalled = (root: string) =>
  NodeFS.existsSync(NodePath.join(root, "apps/mobile/node_modules"));

// Without the mobile dependencies, drops the items whose file is in apps/mobile.
export const withoutMobile = <A>(
  items: ReadonlyArray<A>,
  installed: boolean,
  file: (item: A) => string,
) => {
  if (installed) return { kept: items, skipped: false };
  const kept = items.filter((item) => !file(item).startsWith("apps/mobile/"));
  return { kept, skipped: kept.length < items.length };
};
