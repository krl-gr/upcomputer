import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { HostProcessIsExecutable } from "@t3tools/shared/hostProcess";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as EffectAcpErrors from "effect-acp/errors";

import * as ServerConfig from "../../config.ts";
import * as IdAllocator from "../IdAllocator.ts";
import { ProviderAdapterV2RuntimePolicy } from "../ProviderAdapter.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2RuntimeInput,
} from "./AcpAdapterV2.ts";
import * as ClaudeAdapterV2 from "./ClaudeAdapterV2.ts";
import * as CodexAdapterV2 from "./CodexAdapterV2.ts";

const linked = ["/work/docs", "/work/infra"];

describe("linked project folders in provider sessions", () => {
  it("Claude grants them next to the cwd and the attachments folder", () => {
    const options = ClaudeAdapterV2.makeClaudeQueryOptions({
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
      nativeThreadId: "linked-thread",
      resume: false,
      cwd: "/work/home",
      attachmentsDir: "/data/attachments",
      additionalDirectories: linked,
    });
    assert.deepEqual(options.additionalDirectories, ["/work/home", "/data/attachments", ...linked]);
  });

  it.effect("Codex adds them as writable roots of a workspace-write sandbox only", () =>
    Effect.gen(function* () {
      const build = (runtimeMode: "approval-required" | "auto-accept-edits" | "full-access") =>
        CodexAdapterV2.buildCodexTurnStartParams({
          nativeThreadId: `native-${runtimeMode}`,
          codexInput: [{ type: "text", text: "test" }],
          runtimePolicy: {
            runtimeMode,
            interactionMode: "default",
            cwd: "/work/home",
            additionalDirectories: linked,
          },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        });
      const edits = yield* build("auto-accept-edits");
      assert.deepEqual(edits.sandboxPolicy, { type: "workspaceWrite", writableRoots: linked });
      assert.deepEqual((yield* build("approval-required")).sandboxPolicy, { type: "readOnly" });
      assert.deepEqual((yield* build("full-access")).sandboxPolicy, { type: "dangerFullAccess" });
    }),
  );

  it.effect("ACP agents receive them with the session setup input", () =>
    Effect.gen(function* () {
      let runtimeInput: AcpAdapterV2RuntimeInput | undefined;
      const instanceId = ProviderInstanceId.make("acp-test-linked-folders");
      const adapter = makeAcpAdapterV2({
        crypto: yield* Crypto.Crypto,
        instanceId,
        flavor: {
          driver: ProviderDriverKind.make("acp-test"),
          capabilities: AcpProviderCapabilitiesV2,
          // Capture the input and stop before spawning an agent.
          makeRuntime: (input) =>
            Effect.sync(() => {
              runtimeInput = input;
            }).pipe(
              Effect.andThen(
                Effect.fail(new EffectAcpErrors.AcpTransportError({ detail: "stop", cause: null })),
              ),
            ),
        },
        fileSystem: yield* FileSystem.FileSystem,
        idAllocator: yield* IdAllocator.IdAllocatorV2,
        serverConfig: yield* ServerConfig.ServerConfig,
        selfInvocation: yield* resolveSelfInvocation().pipe(
          Effect.provideService(HostProcessIsExecutable, true),
        ),
      });
      yield* Effect.exit(
        adapter.openSession({
          threadId: ThreadId.make("thread-acp-linked-folders"),
          providerSessionId: ProviderSessionId.make("session-acp-linked-folders"),
          modelSelection: { instanceId, model: "default" },
          runtimePolicy: ProviderAdapterV2RuntimePolicy.make({
            runtimeMode: "full-access",
            interactionMode: "default",
            cwd: "/work/home",
            additionalDirectories: linked,
          }),
        }),
      );
      assert.deepEqual(runtimeInput?.additionalDirectories, linked);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          IdAllocator.layer,
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-linked-folders-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
      Effect.scoped,
    ),
  );
});
