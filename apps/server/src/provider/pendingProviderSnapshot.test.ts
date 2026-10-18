import { ClaudeSettings, CodexSettings } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { makePendingClaudeProvider } from "./ClaudeProvider.ts";
import { makePendingCodexProvider } from "./CodexProvider.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

it.effect("marks only the enabled Codex and Claude placeholders as pending", () =>
  Effect.gen(function* () {
    const codex = yield* makePendingCodexProvider(decodeCodexSettings({ enabled: true }));
    assert.equal(codex.status, "warning");
    assert.equal(codex.statusPending, true);
    const claude = yield* makePendingClaudeProvider(decodeClaudeSettings({ enabled: true }));
    assert.equal(claude.status, "warning");
    assert.equal(claude.statusPending, true);

    const disabledCodex = yield* makePendingCodexProvider(decodeCodexSettings({ enabled: false }));
    assert.equal(disabledCodex.statusPending, undefined);
    const disabledClaude = yield* makePendingClaudeProvider(
      decodeClaudeSettings({ enabled: false }),
    );
    assert.equal(disabledClaude.statusPending, undefined);
  }),
);
