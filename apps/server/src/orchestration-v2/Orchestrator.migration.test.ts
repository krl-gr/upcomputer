import { assert, it } from "@effect/vitest";

import { shouldPrepareLegacyImportHandoff } from "./Orchestrator.ts";
import { type OrchestrationV2ProviderThread } from "@t3tools/contracts";

it("reissues imported context until a V2 run completes", () => {
  assert.isTrue(
    shouldPrepareLegacyImportHandoff({
      historyOrigin: "v1_import",
      hasCompletedRun: false,
      legacyImportItemCount: 2,
    }),
  );
  assert.isFalse(
    shouldPrepareLegacyImportHandoff({
      historyOrigin: "v1_import",
      hasCompletedRun: true,
      legacyImportItemCount: 2,
    }),
  );
  assert.isFalse(
    shouldPrepareLegacyImportHandoff({
      historyOrigin: undefined,
      hasCompletedRun: false,
      legacyImportItemCount: 2,
    }),
  );
  assert.isFalse(
    shouldPrepareLegacyImportHandoff({
      historyOrigin: "v1_import",
      hasCompletedRun: false,
      legacyImportItemCount: 0,
    }),
  );
});

it("does not hand imported history to an imported native session it already holds", () => {
  const importedSession = {
    nativeThreadRef: { driver: "pi", nativeId: "/sessions/a.jsonl", strength: "strong" },
    lastRunOrdinal: null,
  } as unknown as OrchestrationV2ProviderThread;
  const base = {
    historyOrigin: "v1_import",
    hasCompletedRun: false,
    legacyImportItemCount: 2,
  } as const;
  assert.isFalse(
    shouldPrepareLegacyImportHandoff({ ...base, activeProviderThread: importedSession }),
  );
  // Once a V2 run used the session, upstream's reissue-until-completed applies again.
  assert.isTrue(
    shouldPrepareLegacyImportHandoff({
      ...base,
      activeProviderThread: { ...importedSession, lastRunOrdinal: 1 },
    }),
  );
  assert.isTrue(
    shouldPrepareLegacyImportHandoff({
      ...base,
      activeProviderThread: {
        ...importedSession,
        nativeThreadRef: { driver: "pi", nativeId: "/sessions/a.jsonl", strength: "weak" },
      } as OrchestrationV2ProviderThread,
    }),
  );
});
