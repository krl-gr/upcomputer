// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";
import { DEFAULT_MODEL, ThreadId } from "@upcomputer/contracts";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import {
  buildCodexAdditionalContext,
  buildCodexDeveloperInstructions,
  CODEX_ADDITIONAL_CONTEXT_ENTRY_MAX_BYTES,
  CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
import { appendCustomInstructions } from "../CustomInstructions.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import {
  buildCodexAdditionalContextItems,
  buildCodexDynamicTools,
  buildTurnStartParams,
  describeMcpElicitation,
  hasConfiguredMcpServer,
  isRecoverableThreadResumeError,
  makeCodexSessionRuntime,
  makeMemoryConsolidationNotificationFilter,
  openCodexThread,
  readCodexThread,
  rollbackCodexThread,
  supportsCodexInteractionModeAdditionalContext,
  toMcpElicitationResponse,
} from "./CodexSessionRuntime.ts";
const isCodexAppServerRequestError = Schema.is(CodexErrors.CodexAppServerRequestError);

describe("Codex thread history", () => {
  for (const numTurns of [1, 2, 3, 5]) {
    it.effect(`reverts ${numTurns} paginated turns at the durable boundary`, () =>
      Effect.gen(function* () {
        let retained = ["turn-1", "turn-2", "turn-3"];
        const client: Parameters<typeof rollbackCodexThread>[0] = {
          request: () => Effect.die("Legacy history API must not be used for paginated threads"),
          raw: {
            request: (method, params) =>
              Effect.sync(() => {
                if (method === "thread/read") return { thread: { historyMode: "paginated" } };
                if (method === "thread/turns/list") {
                  const { cursor } = params as { cursor: string | null };
                  const start = cursor === null ? 0 : Number(cursor);
                  const ids = retained.slice(start, start + 2);
                  return {
                    data: ids.map((id) => ({ id, items: [], status: "completed" })),
                    nextCursor: start + 2 < retained.length ? String(start + 2) : null,
                  };
                }
                NodeAssert.equal(method, "thread/revert");
                const { beforeTurnId } = params as { beforeTurnId: string };
                retained = retained.slice(0, retained.indexOf(beforeTurnId));
                return { thread: { id: "thread-1", turns: [] } };
              }),
          },
        };
        const result = yield* rollbackCodexThread(client, "thread-1", numTurns);
        const expected = ["turn-1", "turn-2", "turn-3"].slice(0, Math.max(0, 3 - numTurns));
        NodeAssert.deepEqual(
          result.turns.map((turn) => turn.id),
          expected,
        );
        NodeAssert.deepEqual(
          (yield* readCodexThread(client, "thread-1")).turns.map((turn) => turn.id),
          expected,
        );
      }),
    );
  }

  for (const cursors of [
    ["next", "next"],
    ["first", "second", "first"],
  ]) {
    it.effect(`rejects a pagination cursor cycle: ${cursors.join(", ")}`, () =>
      Effect.gen(function* () {
        let pageCount = 0;
        const client: Parameters<typeof readCodexThread>[0] = {
          request: () => Effect.die("Unexpected legacy request"),
          raw: {
            request: (method) =>
              Effect.sync(() => {
                if (method === "thread/read") return { thread: { historyMode: "paginated" } };
                NodeAssert.ok(pageCount < cursors.length, "Repeated cursor was requested");
                return { data: [], nextCursor: cursors[pageCount++] };
              }),
          },
        };
        const error = yield* Effect.flip(readCodexThread(client, "thread-1"));
        NodeAssert.ok(isCodexAppServerRequestError(error));
        NodeAssert.equal(pageCount, cursors.length);
      }),
    );
  }

  it.effect("keeps the count-based rollback API for older threads", () =>
    Effect.gen(function* () {
      const client: Parameters<typeof rollbackCodexThread>[0] = {
        raw: { request: () => Effect.succeed({ thread: {} }) },
        request: <M extends CodexRpc.ClientRequestMethod>(
          method: M,
          params: CodexRpc.ClientRequestParamsByMethod[M],
        ) => {
          NodeAssert.equal(method, "thread/rollback");
          NodeAssert.deepEqual(params, { threadId: "legacy-thread", numTurns: 2 });
          return Effect.succeed({
            thread: { id: "legacy-thread", turns: [] },
          } as unknown as CodexRpc.ClientRequestResponsesByMethod[M]);
        },
      };
      NodeAssert.deepEqual(yield* rollbackCodexThread(client, "legacy-thread", 2), {
        threadId: "legacy-thread",
        turns: [],
      });
    }),
  );
});

describe("CodexSessionRuntimeIdentifierGenerationError", () => {
  it("retains identifier purpose and the random source failure", () => {
    const cause = new Error("random source unavailable");
    const error = new CodexErrors.CodexAppServerIdentifierGenerationError({
      purpose: "provider-event",
      cause,
    });

    NodeAssert.equal(error.purpose, "provider-event");
    NodeAssert.strictEqual(error.cause, cause);
    NodeAssert.equal(
      error.message,
      "Failed to generate Codex App Server identifier for provider-event.",
    );
  });
});

function makeThreadOpenResponse(
  threadId: string,
): CodexRpc.ClientRequestResponsesByMethod["thread/start"] {
  return {
    cwd: "/tmp/project",
    model: "gpt-5.3-codex",
    modelProvider: "openai",
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "dangerFullAccess" },
    thread: {
      id: threadId,
      cliVersion: "0.0.0-test",
      createdAt: 1_776_470_400,
      cwd: "/tmp/project",
      ephemeral: false,
      modelProvider: "openai",
      preview: "",
      sessionId: "session-1",
      source: "cli",
      turns: [],
      status: { type: "idle" },
      updatedAt: 1_776_470_400,
    },
  } as unknown as CodexRpc.ClientRequestResponsesByMethod["thread/start"];
}

describe("buildTurnStartParams", () => {
  it("keeps invalid turn values only in the schema cause", () => {
    const secret = "codex-turn-input-secret-sentinel";
    const error = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        attachments: [
          {
            type: "localImage",
            path: { secret } as unknown as string,
          },
        ],
      }).pipe(Effect.flip),
    );
    const { cause, ...directDiagnostics } = error;

    NodeAssert.equal(error.operation, "decode-request-payload");
    NodeAssert.equal(error.method, "turn/start");
    NodeAssert.ok((error.issueCount ?? 0) > 0);
    NodeAssert.ok(error.issueKinds?.includes("Pointer"));
    NodeAssert.ok((error.maximumPathDepth ?? 0) > 0);
    NodeAssert.ok(Schema.isSchemaError(cause));
    NodeAssert.doesNotMatch(error.message, new RegExp(secret));
    NodeAssert.doesNotMatch(JSON.stringify(directDiagnostics), new RegExp(secret));
  });

  it("includes plan collaboration mode when requested", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Make a plan",
        model: "gpt-5.3-codex",
        effort: "medium",
        interactionMode: "plan",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "dangerFullAccess",
      },
      input: [
        {
          type: "text",
          text: "Make a plan",
        },
      ],
      model: "gpt-5.3-codex",
      effort: "medium",
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("plan"),
        },
      },
      additionalContext: buildCodexAdditionalContext({
        runtime: { model: "gpt-5.3-codex", reasoningEffort: "medium" },
      }),
    });
  });

  it("includes default collaboration mode and image attachments", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto-accept-edits",
        prompt: "Implement it",
        model: "gpt-5.3-codex",
        interactionMode: "default",
        attachments: [
          {
            type: "localImage",
            path: "/tmp/generated.png",
          },
        ],
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "workspaceWrite",
      },
      input: [
        {
          type: "text",
          text: "Implement it",
        },
        {
          type: "localImage",
          path: "/tmp/generated.png",
        },
      ],
      model: "gpt-5.3-codex",
      collaborationMode: {
        mode: "default",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "medium",
          developer_instructions: buildCodexDeveloperInstructions("default"),
        },
      },
      additionalContext: {
        upcomputer_interaction_mode: {
          kind: "application",
          value: buildCodexDeveloperInstructions("default"),
        },
        ...buildCodexAdditionalContext({
          runtime: { model: "gpt-5.3-codex", reasoningEffort: "medium" },
        }),
      },
    });
  });

  it("adds writable roots only to workspace-write sandbox policies", () => {
    const writableRoots = ["/repo/docs", "/repo/api"];
    const policyFor = (
      runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access",
      interactionModeSandbox?: "read-only",
    ) =>
      Effect.runSync(
        buildTurnStartParams({
          threadId: "provider-thread-1",
          runtimeMode,
          writableRoots,
          prompt: "Go",
          ...(interactionModeSandbox ? { interactionModeSandbox } : {}),
        }),
      ).sandboxPolicy;

    NodeAssert.deepStrictEqual(policyFor("auto-accept-edits"), {
      type: "workspaceWrite",
      writableRoots,
    });
    NodeAssert.deepStrictEqual(policyFor("auto"), { type: "workspaceWrite", writableRoots });
    NodeAssert.deepStrictEqual(policyFor("approval-required"), { type: "readOnly" });
    NodeAssert.deepStrictEqual(policyFor("full-access"), { type: "dangerFullAccess" });
    NodeAssert.deepStrictEqual(policyFor("auto-accept-edits", "read-only"), { type: "readOnly" });
  });

  it("reports the same fallback model and effort in settings and instructions", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Go",
        interactionMode: "default",
      }),
    );

    const settings = params.collaborationMode?.settings;
    NodeAssert.equal(settings?.model, DEFAULT_MODEL);
    NodeAssert.equal(settings?.reasoning_effort, "medium");
    NodeAssert.ok(
      params.additionalContext?.upcomputer_runtime?.value.includes(
        `as ${DEFAULT_MODEL} with medium`,
      ),
    );
  });

  it.effect("routes approvals to the auto reviewer in auto mode", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "auto",
        prompt: "Ship it",
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandboxPolicy: {
          type: "workspaceWrite",
        },
        input: [
          {
            type: "text",
            text: "Ship it",
          },
        ],
      });
    }),
  );

  it("omits collaboration mode when interaction mode is absent", () => {
    const params = Effect.runSync(
      buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "approval-required",
        prompt: "Review",
      }),
    );

    NodeAssert.deepStrictEqual(params, {
      threadId: "provider-thread-1",
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandboxPolicy: {
        type: "readOnly",
      },
      input: [
        {
          type: "text",
          text: "Review",
        },
      ],
    });
  });

  it.effect("uses resolved collaboration instructions and sandbox overrides", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Explain the code",
        model: "gpt-5.3-codex",
        interactionMode: "ask",
        interactionModeSandbox: "read-only",
        collaborationMode: {
          mode: "default",
          developerInstructions: CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
        },
      });

      NodeAssert.deepStrictEqual(params, {
        threadId: "provider-thread-1",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: {
          type: "readOnly",
        },
        input: [
          {
            type: "text",
            text: "Explain the code",
          },
        ],
        model: "gpt-5.3-codex",
        collaborationMode: {
          mode: "default",
          settings: {
            model: "gpt-5.3-codex",
            reasoning_effort: "medium",
            developer_instructions: CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
          },
        },
        additionalContext: {
          upcomputer_interaction_mode: {
            kind: "application",
            value: CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
          },
          ...buildCodexAdditionalContext({
            runtime: { model: "gpt-5.3-codex", reasoningEffort: "medium" },
          }),
        },
      });
    }),
  );

  it.effect("keeps Up.computer context out of the mode prompt in every mode", () =>
    Effect.gen(function* () {
      for (const [mode, developerInstructions] of [
        ["default", CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS],
        ["default", CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS],
        ["plan", CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS],
      ] as const) {
        const params = yield* buildTurnStartParams({
          threadId: "provider-thread-1",
          runtimeMode: "full-access",
          prompt: "Hello",
          model: "gpt-5.3-codex",
          effort: "high",
          collaborationMode: { mode, developerInstructions },
        });

        // Newer models replace the mode prompt with their catalog text, so the
        // context must arrive through additional context in plan mode too.
        NodeAssert.equal(
          params.collaborationMode?.settings.developer_instructions,
          developerInstructions,
        );
        NodeAssert.match(
          params.additionalContext?.upcomputer_runtime?.value ?? "",
          /as gpt-5\.3-codex with high reasoning effort/,
        );
        NodeAssert.match(params.additionalContext?.upcomputer_tools?.value ?? "", /preview_open/);
      }
    }),
  );

  it.effect("puts all context in the developer instructions for older Codex versions", () =>
    Effect.gen(function* () {
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Explain the code",
        interactionMode: "ask",
        collaborationMode: {
          mode: "default",
          developerInstructions: CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
        },
        supportsInteractionModeAdditionalContext: false,
      });

      NodeAssert.equal(params.additionalContext, undefined);
      const instructions = params.collaborationMode?.settings.developer_instructions ?? "";
      NodeAssert.ok(instructions.startsWith(`${CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS}\n\n`));
      NodeAssert.match(instructions, /<runtime_info>/);
      NodeAssert.match(instructions, /preview_open/);
    }),
  );

  it.effect("sends custom instructions as additional context in every mode", () =>
    Effect.gen(function* () {
      const customBlock = "# User instructions (from Up.computer settings)\n\nAnswer in Russian.";
      const turn = (input: Partial<Parameters<typeof buildTurnStartParams>[0]>) =>
        buildTurnStartParams({
          threadId: "provider-thread-1",
          runtimeMode: "full-access",
          prompt: "Hello",
          model: "gpt-5.3-codex",
          customInstructions: "Answer in Russian.",
          ...input,
        });

      for (const input of [
        { interactionMode: "default" },
        { interactionMode: "plan" },
        { collaborationMode: { mode: "default", developerInstructions: "Custom default" } },
        { collaborationMode: { mode: "plan", developerInstructions: "Custom plan" } },
      ] as const) {
        const params = yield* turn(input);
        NodeAssert.deepStrictEqual(params.additionalContext?.upcomputer_custom_instructions, {
          kind: "application",
          value: customBlock,
        });
        NodeAssert.doesNotMatch(
          params.collaborationMode?.settings.developer_instructions ?? "",
          /User instructions/,
        );
      }

      const older = yield* turn({
        interactionMode: "plan",
        supportsInteractionModeAdditionalContext: false,
      });
      NodeAssert.ok(
        older.collaborationMode?.settings.developer_instructions?.endsWith(`\n\n${customBlock}`),
      );
    }),
  );

  it.effect("splits long custom instructions under Codex's per-entry cap", () =>
    Effect.gen(function* () {
      const paragraph = `${Array.from({ length: 40 }, () => "Отвечай по-русски.").join(" ")}\n`;
      const customInstructions = paragraph.repeat(20);
      const params = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Hello",
        interactionMode: "default",
        customInstructions,
      });

      const entries = Object.entries(params.additionalContext ?? {}).filter(([key]) =>
        key.startsWith("upcomputer_custom_instructions"),
      );
      NodeAssert.ok(entries.length > 1);
      NodeAssert.deepStrictEqual(
        entries.map(([key]) => key),
        entries.map((_, index) =>
          index === 0
            ? "upcomputer_custom_instructions"
            : `upcomputer_custom_instructions_${index + 1}`,
        ),
      );
      for (const [, entry] of Object.entries(params.additionalContext ?? {})) {
        NodeAssert.ok(Buffer.byteLength(entry.value) <= CODEX_ADDITIONAL_CONTEXT_ENTRY_MAX_BYTES);
      }
      NodeAssert.equal(
        entries.map(([, entry]) => entry.value).join("\n"),
        `# User instructions (from Up.computer settings)\n\n${customInstructions.trim()}`,
      );
    }),
  );

  it.effect("keeps developer instructions unchanged without custom instructions", () =>
    Effect.gen(function* () {
      const withEmpty = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Hello",
        interactionMode: "default",
        customInstructions: "",
      });
      const without = yield* buildTurnStartParams({
        threadId: "provider-thread-1",
        runtimeMode: "full-access",
        prompt: "Hello",
        interactionMode: "default",
      });

      NodeAssert.deepStrictEqual(withEmpty, without);
      NodeAssert.equal(appendCustomInstructions("base", "   "), "base");
    }),
  );
});

describe("supportsCodexInteractionModeAdditionalContext", () => {
  it("gates the workaround to Codex versions that support turn additional context", () => {
    NodeAssert.equal(supportsCodexInteractionModeAdditionalContext(undefined), false);
    NodeAssert.equal(supportsCodexInteractionModeAdditionalContext("not-semver"), false);
    NodeAssert.equal(supportsCodexInteractionModeAdditionalContext("0.134.0"), false);
    NodeAssert.equal(supportsCodexInteractionModeAdditionalContext("0.141.0"), true);
    NodeAssert.equal(supportsCodexInteractionModeAdditionalContext("0.145.0"), true);
  });
});

describe("Codex MCP elicitation approvals", () => {
  const request = {
    mode: "form",
    message: "Allow ChatGPT to use Safari?",
    serverName: "computer-use",
    threadId: "provider-thread-1",
    turnId: "turn-1",
    _meta: {
      app_name: "Safari",
      persist: ["session", "always"],
    },
    requestedSchema: {
      type: "object",
      properties: {
        approval: {
          type: "string",
          oneOf: [
            { const: "once", title: "Allow once" },
            { const: "session", title: "Allow for this session" },
            { const: "always", title: "Always allow Safari" },
          ],
        },
      },
      required: ["approval"],
    },
  } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

  it("preserves the app name and advertised persistence choices", () => {
    NodeAssert.deepStrictEqual(describeMcpElicitation(request), {
      appName: "Safari",
      options: [
        { decision: "cancel", label: "Cancel" },
        { decision: "decline", label: "Decline" },
        { decision: "acceptForSession", label: "Allow for this session" },
        { decision: "acceptAlways", label: "Always allow Safari" },
        { decision: "accept", label: "Approve" },
      ],
    });
  });

  it("extracts the app name from a Computer Use request without metadata", () => {
    const { _meta, ...requestWithoutMetadata } = request;

    NodeAssert.equal(describeMcpElicitation(requestWithoutMetadata).appName, "Safari");
  });

  it("returns the accepted form option to Codex", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "accept"), {
      action: "accept",
      content: { approval: "once" },
    });
  });

  it("returns session-scoped approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptForSession"), {
      action: "accept",
      _meta: { persist: "session" },
      content: { approval: "session" },
    });
  });

  it("returns persistent approval in the MCP response", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("returns rejection without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "decline"), {
      action: "decline",
    });
  });

  it("returns cancellation without form content", () => {
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(request, "cancel"), {
      action: "cancel",
    });
  });

  it("supports boolean permanent-approval fields", () => {
    const booleanRequest = {
      ...request,
      _meta: { app_name: "Safari" },
      requestedSchema: {
        type: "object",
        properties: {
          always: { type: "boolean", title: "Always allow Safari" },
        },
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.ok(
      describeMcpElicitation(booleanRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(booleanRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { always: true },
    });
  });

  it("preserves valid nullable MCP form fields and persistence choices", () => {
    const nullableRequest = {
      ...request,
      _meta: {
        app_name: null,
        appName: "Safari",
        connector_name: null,
        persist: null,
        target: null,
        tool_params: null,
      },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            title: null,
            description: null,
            default: null,
            enum: ["once", "always"],
            enumNames: null,
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.equal(describeMcpElicitation(nullableRequest).appName, "Safari");
    NodeAssert.ok(
      describeMcpElicitation(nullableRequest).options.some(
        (option) => option.decision === "acceptAlways",
      ),
    );
    NodeAssert.deepStrictEqual(toMcpElicitationResponse(nullableRequest, "acceptAlways"), {
      action: "accept",
      _meta: { persist: "always" },
      content: { approval: "always" },
    });
  });

  it("declines required form fields that an approval prompt cannot collect", () => {
    const inputRequest = {
      ...request,
      requestedSchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
        },
        required: ["email"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(inputRequest, "accept"), {
      action: "decline",
    });
  });

  it("does not approve URL elicitations without opening their requested URL", () => {
    const urlRequest = {
      mode: "url",
      message: "Finish signing in to continue.",
      serverName: "computer-use",
      threadId: "provider-thread-1",
      turnId: "turn-1",
      elicitationId: "sign-in-1",
      url: "https://example.com/authorize",
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(toMcpElicitationResponse(urlRequest, "accept"), {
      action: "decline",
    });
  });

  it("omits persistence choices that cannot satisfy required form fields", () => {
    const onceOnlyRequest = {
      ...request,
      _meta: { app_name: "Safari", persist: ["session", "always"] },
      requestedSchema: {
        type: "object",
        properties: {
          approval: {
            type: "string",
            enum: ["once"],
          },
        },
        required: ["approval"],
      },
    } satisfies EffectCodexSchema.McpServerElicitationRequestParams;

    NodeAssert.deepStrictEqual(describeMcpElicitation(onceOnlyRequest).options, [
      { decision: "cancel", label: "Cancel" },
      { decision: "decline", label: "Decline" },
      { decision: "accept", label: "Approve" },
    ]);
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("keeps Up.computer context out of the mode prompt, which the model catalog can replace", () => {
    for (const instructions of [
      buildCodexDeveloperInstructions("default"),
      buildCodexDeveloperInstructions("plan"),
      CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS,
    ]) {
      NodeAssert.match(instructions, /^<collaboration_mode>[\s\S]*<\/collaboration_mode>$/);
      NodeAssert.doesNotMatch(instructions, /runtime_info|preview_|User instructions/);
    }
  });
});

describe("buildCodexAdditionalContext", () => {
  const runtime = { model: "gpt-5.3-codex", reasoningEffort: "high" };
  const runtimeValue = (context: ReturnType<typeof buildCodexAdditionalContext>) =>
    context.upcomputer_runtime?.value ?? "";

  it("describes the harness, model and effort", () => {
    const context = buildCodexAdditionalContext({ runtime });

    NodeAssert.equal(context.upcomputer_runtime?.kind, "application");
    NodeAssert.match(
      runtimeValue(context),
      /^<runtime_info>.*UpComputer through the Codex harness, as gpt-5\.3-codex with high reasoning effort.*<\/runtime_info>$/,
    );
  });

  it("varies with the model and effort of each turn", () => {
    NodeAssert.notEqual(
      runtimeValue(
        buildCodexAdditionalContext({
          runtime: { model: "gpt-5.3-codex", reasoningEffort: "medium" },
        }),
      ),
      runtimeValue(
        buildCodexAdditionalContext({ runtime: { model: "gpt-5.4", reasoningEffort: "high" } }),
      ),
    );
  });

  it("flattens multiline metadata into single-line runtime info", () => {
    const value = runtimeValue(
      buildCodexAdditionalContext({
        runtime: { model: "gpt\n5.3\ncodex", reasoningEffort: " high\neffort " },
      }),
    );

    NodeAssert.match(value, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(value, /<runtime_info>[^<]*\n/);
  });

  it("prefers the product-native preview tools", () => {
    const tools = buildCodexAdditionalContext({ runtime }).upcomputer_tools?.value ?? "";
    NodeAssert.match(tools, /upcomputer/);
    NodeAssert.match(tools, /preview_status/);
    NodeAssert.match(tools, /preview_open/);
    NodeAssert.match(tools, /Do not switch to global browser skills/);
  });

  it("keeps every entry under Codex's per-entry cap", () => {
    const context = buildCodexAdditionalContext({ runtime, customInstructions: "Be brief." });
    NodeAssert.deepStrictEqual(Object.keys(context), [
      "upcomputer_runtime",
      "upcomputer_tools",
      "upcomputer_custom_instructions",
    ]);
    for (const entry of Object.values(context)) {
      NodeAssert.ok(Buffer.byteLength(entry.value) <= CODEX_ADDITIONAL_CONTEXT_ENTRY_MAX_BYTES);
    }
    NodeAssert.ok(
      Buffer.byteLength(CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS) <=
        CODEX_ADDITIONAL_CONTEXT_ENTRY_MAX_BYTES,
    );
    NodeAssert.ok(
      Buffer.byteLength(CODEX_ASK_MODE_DEVELOPER_INSTRUCTIONS) <=
        CODEX_ADDITIONAL_CONTEXT_ENTRY_MAX_BYTES,
    );
  });
});

describe("buildCodexAdditionalContextItems", () => {
  it("renders each entry as a developer message, as Codex does", () => {
    NodeAssert.deepStrictEqual(
      buildCodexAdditionalContextItems({
        upcomputer_runtime: { kind: "application", value: "<runtime_info>x</runtime_info>" },
        upcomputer_tools: { kind: "application", value: "tools" },
      }),
      [
        {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: "<upcomputer_runtime><runtime_info>x</runtime_info></upcomputer_runtime>",
            },
          ],
        },
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "<upcomputer_tools>tools</upcomputer_tools>" }],
        },
      ],
    );
  });
});

describe("hasConfiguredMcpServer", () => {
  it("detects inline Codex MCP configuration arguments", () => {
    NodeAssert.equal(hasConfiguredMcpServer(undefined), false);
    NodeAssert.equal(hasConfiguredMcpServer(["--model", "gpt-5.4"]), false);
    NodeAssert.equal(
      hasConfiguredMcpServer(["-c", 'mcp_servers.upcomputer.url="http://127.0.0.1/mcp"']),
      true,
    );
  });
});

function makeThreadStartedNotification(
  threadId: string,
  source: EffectCodexSchema.V2ThreadStartedNotification["thread"]["source"],
  threadSource?: string,
) {
  return {
    method: "thread/started" as const,
    params: {
      thread: {
        cliVersion: "0.0.0",
        createdAt: 0,
        cwd: "/tmp/project",
        ephemeral: true,
        id: threadId,
        modelProvider: "openai",
        preview: "",
        sessionId: threadId,
        source,
        status: { type: "idle" as const },
        ...(threadSource ? { threadSource } : {}),
        turns: [],
        updatedAt: 0,
      },
    },
  };
}

describe("makeMemoryConsolidationNotificationFilter", () => {
  it("suppresses memory consolidation without hiding other Codex subagents", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
      ),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "internal memory update",
          itemId: "memory-message",
          threadId: "memory-thread",
          turnId: "memory-turn",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "serverRequest/resolved",
        params: {
          requestId: "memory-approval",
          threadId: "memory-thread",
        },
      }),
      false,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "warning",
        params: {
          message: "internal warning",
          threadId: "memory-thread",
        },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "normal reply",
          itemId: "root-message",
          threadId: "root-thread",
          turnId: "root-turn",
        },
      }),
      false,
    );

    NodeAssert.equal(
      shouldSuppress(
        makeThreadStartedNotification("legacy-memory-thread", {
          subAgent: "memory_consolidation",
        }),
      ),
      true,
    );

    for (const source of [
      { subAgent: "review" as const },
      { subAgent: "compact" as const },
      {
        subAgent: {
          thread_spawn: {
            depth: 1,
            parent_thread_id: "root-thread",
          },
        },
      },
    ]) {
      NodeAssert.equal(
        shouldSuppress(makeThreadStartedNotification("visible-subagent", source)),
        false,
      );
    }
  });

  it("forgets memory consolidation threads after they close", () => {
    const shouldSuppress = makeMemoryConsolidationNotificationFilter();
    shouldSuppress(
      makeThreadStartedNotification("memory-thread", "unknown", "memory_consolidation"),
    );

    NodeAssert.equal(
      shouldSuppress({
        method: "thread/closed",
        params: { threadId: "memory-thread" },
      }),
      true,
    );
    NodeAssert.equal(
      shouldSuppress({
        method: "item/agentMessage/delta",
        params: {
          delta: "later message",
          itemId: "later-message",
          threadId: "memory-thread",
          turnId: "later-turn",
        },
      }),
      false,
    );
  });
});

describe("codexSessionAppServerArgs", () => {
  it("keeps the app-server subcommand when explicit args are provided", () => {
    NodeAssert.deepStrictEqual(codexSessionAppServerArgs(["-c", "model=gpt-5"], undefined), [
      "app-server",
      "-c",
      "model=gpt-5",
    ]);
  });

  it("keeps launch args when explicit app-server args are provided", () => {
    NodeAssert.deepStrictEqual(
      codexSessionAppServerArgs(
        ["-c", "mcp_servers.upcomputer.url=http://127.0.0.1/mcp"],
        "--strict-config --enable foo",
      ),
      [
        "app-server",
        "--strict-config",
        "--enable",
        "foo",
        "-c",
        "mcp_servers.upcomputer.url=http://127.0.0.1/mcp",
      ],
    );
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("matches missing thread errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Thread does not exist",
        }),
      ),
      true,
    );
  });

  it("matches Codex 0.154 missing-rollout resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "state db missing rollout path for thread stale-thread",
        }),
      ),
      true,
    );
  });

  it("matches a missing rollout for a known thread id", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "no rollout found for thread id 019fdf74-aaa9-7950-b252-7cc7a8650470",
        }),
      ),
      true,
    );
  });

  it("keeps thread/model misalignment errors visible instead of silently restarting", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "thread model is misaligned with the requested model",
        }),
      ),
      false,
    );
  });

  it("ignores non-recoverable resume errors", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Permission denied",
        }),
      ),
      false,
    );
  });

  it("ignores unrelated missing-resource errors that do not mention threads", () => {
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Config file not found",
        }),
      ),
      false,
    );
    NodeAssert.equal(
      isRecoverableThreadResumeError(
        new CodexErrors.CodexAppServerRequestError({
          code: -32603,
          errorMessage: "Model does not exist",
        }),
      ),
      false,
    );
  });
});

describe("openCodexThread", () => {
  it.effect("resumes metadata when historical turns contain unknown error values", () =>
    Effect.gen(function* () {
      const response = makeThreadOpenResponse("saved-thread");
      const calls: unknown[] = [];
      const opened = yield* openCodexThread({
        client: {
          request: () => Effect.die("A valid resumed thread must not start fresh"),
          raw: {
            request: (method, payload) => {
              calls.push({ method, payload });
              return Effect.succeed({
                ...response,
                thread: {
                  ...response.thread,
                  turns: [
                    {
                      id: "old-turn",
                      status: "failed",
                      items: [],
                      error: {
                        message: "Historical provider error",
                        codexErrorInfo: "misalignment_policy_violation",
                      },
                    },
                  ],
                },
              });
            },
          },
        },
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "auto",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: "fast",
        resumeThreadId: "saved-thread",
      });

      NodeAssert.deepStrictEqual(opened, {
        cwd: response.cwd,
        model: response.model,
        thread: { id: "saved-thread" },
      });
      NodeAssert.deepStrictEqual(calls, [
        {
          method: "thread/resume",
          payload: {
            threadId: "saved-thread",
            cwd: "/tmp/project",
            model: "gpt-5.3-codex",
            serviceTier: "fast",
            approvalPolicy: "on-request",
            sandbox: "workspace-write",
            approvalsReviewer: "auto_review",
            excludeTurns: true,
          },
        },
      ]);
    }),
  );

  it.effect("rejects malformed required resume metadata without starting a fresh thread", () =>
    Effect.gen(function* () {
      for (const invalidMetadata of [
        { cwd: null },
        { model: 42 },
        { thread: { id: null } },
        { thread: {} },
      ]) {
        const error = yield* openCodexThread({
          client: {
            request: () => Effect.die("Invalid resume metadata must not start a fresh thread"),
            raw: {
              request: () =>
                Effect.succeed({ ...makeThreadOpenResponse("saved-thread"), ...invalidMetadata }),
            },
          },
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "full-access",
          cwd: "/tmp/project",
          requestedModel: "gpt-5.3-codex",
          serviceTier: undefined,
          resumeThreadId: "saved-thread",
        }).pipe(Effect.flip);

        NodeAssert.ok(isCodexAppServerRequestError(error));
        NodeAssert.equal(error.operation, "decode-payload");
        NodeAssert.equal(error.method, "thread/resume");
      }
    }),
  );

  it.effect("falls back to thread/start when resume fails recoverably", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: "thread/start" | "thread/resume"; payload: unknown }> = [];
      const started = makeThreadOpenResponse("fresh-thread");
      const client = {
        raw: {
          request: (method: "thread/start" | "thread/resume", payload: unknown) => {
            calls.push({ method, payload });
            return Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "thread not found",
              }),
            );
          },
        },
        request: (
          method: "thread/start",
          payload: CodexRpc.ClientRequestParamsByMethod["thread/start"],
        ) => {
          calls.push({ method, payload });
          return Effect.succeed(started);
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      });

      NodeAssert.equal(opened.thread.id, "fresh-thread");
      NodeAssert.deepStrictEqual(
        calls.map((call) => call.method),
        ["thread/resume", "thread/start"],
      );
    }),
  );

  it("converts flat registrations to canonical Codex dynamic tools", () => {
    NodeAssert.deepStrictEqual(
      buildCodexDynamicTools([
        {
          type: "function",
          name: "standalone_tool",
          description: "A standalone tool.",
          inputSchema: { type: "object" },
        },
        {
          type: "function",
          namespace: "upcomputer_tasks",
          name: "task_context",
          description: "Resolve task context.",
          inputSchema: { type: "object" },
        },
        {
          type: "function",
          namespace: "upcomputer_tasks",
          name: "task_get",
          description: "Load one task.",
          inputSchema: { type: "object" },
        },
      ]),
      [
        {
          type: "function",
          name: "standalone_tool",
          description: "A standalone tool.",
          inputSchema: { type: "object" },
        },
        {
          type: "namespace",
          name: "upcomputer_tasks",
          description: "Tools in the 'upcomputer_tasks' namespace.",
          tools: [
            {
              type: "function",
              name: "task_context",
              description: "Resolve task context.",
              inputSchema: { type: "object" },
            },
            {
              type: "function",
              name: "task_get",
              description: "Load one task.",
              inputSchema: { type: "object" },
            },
          ],
        },
      ],
    );
  });

  it.effect("sends canonical dynamic tools through raw thread/start", () =>
    Effect.gen(function* () {
      const calls: Array<{ kind: "typed" | "raw"; method: string; payload: unknown }> = [];
      const started = makeThreadOpenResponse("dynamic-thread");
      const client = {
        request: (
          method: "thread/start",
          payload: CodexRpc.ClientRequestParamsByMethod["thread/start"],
        ) => {
          calls.push({ kind: "typed", method, payload });
          return Effect.succeed(started);
        },
        raw: {
          request: (method: "thread/start" | "thread/resume", payload: unknown) => {
            calls.push({ kind: "raw", method, payload });
            return Effect.succeed(started);
          },
        },
      };

      const opened = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: undefined,
        dynamicTools: [
          {
            type: "namespace",
            name: "upcomputer_tasks",
            description: "Task management tools.",
            tools: [
              {
                type: "function",
                name: "task_context",
                description: "Resolve task context.",
                inputSchema: { type: "object" },
              },
            ],
          },
        ],
      });

      NodeAssert.equal(opened.thread.id, "dynamic-thread");
      NodeAssert.equal(calls.length, 1);
      NodeAssert.deepStrictEqual(calls[0], {
        kind: "raw",
        method: "thread/start",
        payload: {
          cwd: "/tmp/project",
          approvalPolicy: "never",
          approvalsReviewer: "user",
          sandbox: "danger-full-access",
          model: "gpt-5.3-codex",
          dynamicTools: [
            {
              type: "namespace",
              name: "upcomputer_tasks",
              description: "Task management tools.",
              tools: [
                {
                  type: "function",
                  name: "task_context",
                  description: "Resolve task context.",
                  inputSchema: { type: "object" },
                },
              ],
            },
          ],
        },
      });
    }),
  );

  it.effect("propagates non-recoverable resume failures", () =>
    Effect.gen(function* () {
      const client = {
        request: () => Effect.die("Non-recoverable resume failures must not start a fresh thread"),
        raw: {
          request: () =>
            Effect.fail(
              new CodexErrors.CodexAppServerRequestError({
                code: -32603,
                errorMessage: "timed out waiting for server",
              }),
            ),
        },
      };

      const error = yield* openCodexThread({
        client,
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        cwd: "/tmp/project",
        requestedModel: "gpt-5.3-codex",
        serviceTier: undefined,
        resumeThreadId: "stale-thread",
      }).pipe(Effect.flip);

      NodeAssert.ok(isCodexAppServerRequestError(error));
      NodeAssert.equal(error.errorMessage, "timed out waiting for server");
    }),
  );
});

describe("CodexSessionRuntime compaction", () => {
  // A stdio stand-in for `codex app-server`: it compacts the root thread (and
  // a child thread) during the first turn and records `thread/inject_items`.
  const MOCK_PEER = `
const fs = require("node:fs");
const readline = require("node:readline");
const { MOCK_THREAD_START: threadStart, MOCK_REQUESTS_PATH: requestsPath } = process.env;
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const compacted = (threadId) => ({
  method: "item/completed",
  params: {
    threadId,
    turnId: "turn-1",
    completedAtMs: 0,
    item: { type: "contextCompaction", id: "compaction-" + threadId },
  },
});
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === "initialize") {
    write({ id, result: { userAgent: "codex_cli_rs/0.159.1", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" } });
  } else if (method === "thread/start") {
    write({ id, result: JSON.parse(threadStart) });
  } else if (method === "turn/start") {
    write({ id, result: { turn: { id: "turn-1", items: [], status: "inProgress" } } });
    write(compacted("child-thread"));
    write(compacted("root-thread"));
  } else if (method === "thread/inject_items") {
    fs.appendFileSync(requestsPath, JSON.stringify({ method, params }) + "\\n");
    write({ id, result: {} });
    write({ method: "turn/completed", params: { threadId: "root-thread", turn: { id: "turn-1", items: [], status: "completed" } } });
  } else if (id !== undefined) {
    write({ id, result: {} });
  }
});
`;

  it.effect(
    "restores the Up.computer context after the root thread compacts",
    () =>
      Effect.gen(function* () {
        const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "codex-compaction-"));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
        );
        const peerPath = NodePath.join(dir, "codex");
        const requestsPath = NodePath.join(dir, "requests.jsonl");
        NodeFS.writeFileSync(peerPath, `#!/usr/bin/env node\n${MOCK_PEER}`, { mode: 0o755 });

        const runtime = yield* makeCodexSessionRuntime({
          threadId: ThreadId.make("thread-compaction-context"),
          binaryPath: peerPath,
          cwd: dir,
          runtimeMode: "full-access",
          environment: {
            ...process.env,
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            MOCK_THREAD_START: JSON.stringify(makeThreadOpenResponse("root-thread")),
            MOCK_REQUESTS_PATH: requestsPath,
          },
          customInstructions: "Answer in Russian.",
        });
        const completed = yield* runtime.events.pipe(
          Stream.filter((event) => event.method === "turn/completed"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        );

        yield* runtime.start();
        yield* runtime.sendTurn({ input: "keep going", interactionMode: "plan" });
        yield* Fiber.join(completed);

        // The restore is awaited before later notifications, so it has landed.
        const requests = NodeFS.readFileSync(requestsPath, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
        NodeAssert.equal(requests.length, 1);
        const [inject] = requests;
        NodeAssert.ok(inject);
        NodeAssert.equal(inject.params.threadId, "root-thread");
        const items = inject.params.items as ReadonlyArray<{
          role: string;
          content: [{ text: string }];
        }>;
        const texts = items.map((item) => {
          NodeAssert.equal(item.role, "developer");
          return item.content[0].text;
        });
        NodeAssert.equal(texts.length, 3);
        NodeAssert.match(
          texts[0] ?? "",
          /^<upcomputer_runtime><runtime_info>.*<\/upcomputer_runtime>$/s,
        );
        NodeAssert.match(
          texts[1] ?? "",
          /^<upcomputer_tools>.*preview_open.*<\/upcomputer_tools>$/s,
        );
        NodeAssert.match(
          texts[2] ?? "",
          /^<upcomputer_custom_instructions>.*Answer in Russian\.<\/upcomputer_custom_instructions>$/s,
        );

        yield* runtime.close;
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    15_000,
  );
});
