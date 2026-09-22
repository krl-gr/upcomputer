import {
  ApprovalRequestId,
  DEFAULT_MODEL,
  EventId,
  type InteractionModeSandboxPolicy,
  ProviderDriverKind,
  ProviderItemId,
  type ProviderInstanceId,
  type ProviderApprovalDecision,
  type ProviderEvent,
  type ProviderInteractionMode,
  type ProviderRequestKind,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@upcomputer/contracts";
import { resolveSpawnCommand } from "@upcomputer/shared/shell";
import { normalizeModelSlug } from "@upcomputer/shared/model";
import { compareSemverVersions, parseSemver } from "@upcomputer/shared/semver";
import { codexVersionFromUserAgent } from "../codexVersion.ts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexRpc from "effect-codex-app-server/rpc";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { buildCodexInitializeParams } from "./CodexProvider.ts";
import { codexSessionAppServerArgs } from "./codexLaunchArgs.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import type {
  ExperimentalDynamicToolLease,
  ExperimentalDynamicToolRegistry,
  ExperimentalDynamicToolSpec,
} from "../../product/DynamicToolRegistry.ts";
import {
  buildCodexDeveloperInstructions,
  CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS,
  CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS,
} from "../CodexDeveloperInstructions.ts";
const decodeV2ThreadResumeResponse = Schema.decodeUnknownEffect(
  EffectCodexSchema.V2ThreadResumeResponse,
);
const decodeV2ThreadStartResponse = Schema.decodeUnknownEffect(
  EffectCodexSchema.V2ThreadStartResponse,
);
const decodeV2TurnStartResponse = Schema.decodeUnknownEffect(EffectCodexSchema.V2TurnStartResponse);

const PROVIDER = ProviderDriverKind.make("codex");

const ANSI_ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_ESCAPE_REGEX = new RegExp(`${ANSI_ESCAPE_CHAR}\\[[0-9;]*m`, "g");
const CODEX_STDERR_LOG_REGEX =
  /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+\S+:\s+(.*)$/;
const BENIGN_ERROR_LOG_SNIPPETS = [
  "state db missing rollout path for thread",
  "state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back",
];
const CODEX_APP_SERVER_FORCE_KILL_AFTER = "2 seconds" as const;
const CODEX_ADDITIONAL_CONTEXT_MINIMUM_VERSION = "0.141.0";
const RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS = [
  "not found",
  "missing thread",
  "no such thread",
  "unknown thread",
  "does not exist",
  "missing rollout",
  "rollout path",
];

export function hasConfiguredMcpServer(appServerArgs: ReadonlyArray<string> | undefined): boolean {
  return appServerArgs?.some((argument) => argument.includes("mcp_servers.")) === true;
}

export function supportsCodexInteractionModeAdditionalContext(
  cliVersion: string | undefined,
): boolean {
  return (
    cliVersion !== undefined &&
    parseSemver(cliVersion) !== null &&
    compareSemverVersions(cliVersion, CODEX_ADDITIONAL_CONTEXT_MINIMUM_VERSION) >= 0
  );
}

export const CodexResumeCursorSchema = Schema.Struct({
  threadId: Schema.String,
});
const CodexUserInputAnswerObject = Schema.Struct({
  answers: Schema.Array(Schema.String),
});
const isCodexResumeCursorSchema = Schema.is(CodexResumeCursorSchema);
const isCodexUserInputAnswerObject = Schema.is(CodexUserInputAnswerObject);

// TODO: Verify `packages/effect-codex-app-server/scripts/generate.ts` so the generated
// `V2TurnStartParams` schema includes these experimental fields directly.
const CodexTurnStartParamsWithCollaborationMode = EffectCodexSchema.V2TurnStartParams.pipe(
  Schema.fieldsAssign({
    collaborationMode: Schema.optionalKey(EffectCodexSchema.V2TurnStartParams__CollaborationMode),
    additionalContext: Schema.optionalKey(
      Schema.Record(Schema.String, EffectCodexSchema.V2TurnStartParams__AdditionalContextEntry),
    ),
  }),
);
const decodeCodexTurnStartParamsWithCollaborationMode = Schema.decodeUnknownEffect(
  CodexTurnStartParamsWithCollaborationMode,
);

export type CodexTurnStartParamsWithCollaborationMode =
  typeof CodexTurnStartParamsWithCollaborationMode.Type;

export type CodexResumeCursor = typeof CodexResumeCursorSchema.Type;
type CodexServiceTier = NonNullable<EffectCodexSchema.V2ThreadStartParams["serviceTier"]>;
type CodexDynamicToolFunctionSpec = {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
};
type CodexDynamicToolNamespaceSpec = {
  readonly type: "namespace";
  readonly name: string;
  readonly description: string;
  readonly tools: ReadonlyArray<CodexDynamicToolFunctionSpec>;
};
type CodexDynamicToolSpec = CodexDynamicToolFunctionSpec | CodexDynamicToolNamespaceSpec;
type CodexThreadStartParamsWithDynamicTools = EffectCodexSchema.V2ThreadStartParams & {
  readonly dynamicTools?: ReadonlyArray<CodexDynamicToolSpec>;
};
type CodexThreadResumeParamsWithDynamicTools = EffectCodexSchema.V2ThreadResumeParams & {
  readonly dynamicTools?: ReadonlyArray<CodexDynamicToolSpec>;
};
type CodexThreadItem =
  | EffectCodexSchema.V2ThreadReadResponse["thread"]["turns"][number]["items"][number]
  | EffectCodexSchema.V2ThreadRollbackResponse["thread"]["turns"][number]["items"][number];

export interface CodexSessionRuntimeOptions {
  readonly threadId: ThreadId;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly launchArgs?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier | undefined;
  readonly resumeCursor?: CodexResumeCursor;
  readonly appServerArgs?: ReadonlyArray<string>;
  readonly dynamicToolRegistry?: ExperimentalDynamicToolRegistry<never, never>;
}

export interface CodexSessionRuntimeSendTurnInput {
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier | undefined;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort | undefined;
  readonly interactionMode?: ProviderInteractionMode;
  readonly interactionModeSandbox?: InteractionModeSandboxPolicy;
  readonly mutationPolicy?: "allow" | "deny";
  readonly collaborationMode?: CodexSessionRuntimeCollaborationModeInput;
}

export interface CodexSessionRuntimeCollaborationModeInput {
  readonly mode: EffectCodexSchema.V2TurnStartParams__ModeKind;
  readonly developerInstructions?: string;
}

export interface CodexThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<CodexThreadItem>;
}

export interface CodexThreadSnapshot {
  readonly threadId: string;
  readonly turns: ReadonlyArray<CodexThreadTurnSnapshot>;
}

export interface CodexSessionRuntimeShape {
  readonly start: () => Effect.Effect<ProviderSession, CodexSessionRuntimeError>;
  readonly getSession: Effect.Effect<ProviderSession>;
  readonly sendTurn: (
    input: CodexSessionRuntimeSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, CodexSessionRuntimeError>;
  readonly interruptTurn: (turnId?: TurnId) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly readThread: Effect.Effect<CodexThreadSnapshot, CodexSessionRuntimeError>;
  readonly rollbackThread: (
    numTurns: number,
  ) => Effect.Effect<CodexThreadSnapshot, CodexSessionRuntimeError>;
  readonly respondToRequest: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly respondToUserInput: (
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly events: Stream.Stream<ProviderEvent, never>;
  readonly close: Effect.Effect<void>;
}

export type CodexSessionRuntimeError =
  | CodexErrors.CodexAppServerError
  | CodexSessionRuntimePendingApprovalNotFoundError
  | CodexSessionRuntimePendingUserInputNotFoundError
  | CodexSessionRuntimeInvalidUserInputAnswersError
  | CodexSessionRuntimeThreadIdMissingError;

export class CodexSessionRuntimePendingApprovalNotFoundError extends Schema.TaggedErrorClass<CodexSessionRuntimePendingApprovalNotFoundError>()(
  "CodexSessionRuntimePendingApprovalNotFoundError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown pending Codex approval request: ${this.requestId}`;
  }
}

export class CodexSessionRuntimePendingUserInputNotFoundError extends Schema.TaggedErrorClass<CodexSessionRuntimePendingUserInputNotFoundError>()(
  "CodexSessionRuntimePendingUserInputNotFoundError",
  {
    requestId: Schema.String,
  },
) {
  override get message(): string {
    return `Unknown pending Codex user input request: ${this.requestId}`;
  }
}

export class CodexSessionRuntimeInvalidUserInputAnswersError extends Schema.TaggedErrorClass<CodexSessionRuntimeInvalidUserInputAnswersError>()(
  "CodexSessionRuntimeInvalidUserInputAnswersError",
  {
    questionId: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid Codex user input answers for question '${this.questionId}'`;
  }
}

export class CodexSessionRuntimeThreadIdMissingError extends Schema.TaggedErrorClass<CodexSessionRuntimeThreadIdMissingError>()(
  "CodexSessionRuntimeThreadIdMissingError",
  {
    threadId: Schema.String,
  },
) {
  override get message(): string {
    return `Codex session is missing a provider thread id for ${this.threadId}`;
  }
}

interface PendingApproval {
  readonly requestId: ApprovalRequestId;
  readonly jsonRpcId: string;
  readonly requestKind: ProviderRequestKind;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
}

interface ApprovalCorrelation {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: ProviderRequestKind;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
}

interface PendingUserInput {
  readonly requestId: ApprovalRequestId;
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface TurnDynamicToolPolicy {
  readonly mutationPolicy: "allow" | "deny";
  readonly interactionMode?: ProviderInteractionMode;
}

type CodexServerNotification = {
  readonly [M in CodexRpc.ServerNotificationMethod]: {
    readonly method: M;
    readonly params: CodexRpc.ServerNotificationParamsByMethod[M];
  };
}[CodexRpc.ServerNotificationMethod];

function makeCodexServerNotification<M extends CodexRpc.ServerNotificationMethod>(
  method: M,
  params: CodexRpc.ServerNotificationParamsByMethod[M],
): CodexServerNotification {
  return { method, params } as CodexServerNotification;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCodexModelSlug(
  model: string | undefined | null,
  preferredId?: string,
): string | undefined {
  const normalized = normalizeModelSlug(model);
  if (!normalized) {
    return undefined;
  }
  if (preferredId?.endsWith("-codex") && preferredId !== normalized) {
    return preferredId;
  }
  return normalized;
}

function readResumeCursorThreadId(
  resumeCursor: ProviderSession["resumeCursor"],
): string | undefined {
  return isCodexResumeCursorSchema(resumeCursor) ? resumeCursor.threadId : undefined;
}

function runtimeModeToThreadConfig(input: RuntimeMode): {
  readonly approvalPolicy: EffectCodexSchema.V2ThreadStartParams__AskForApproval;
  readonly sandbox: EffectCodexSchema.V2ThreadStartParams__SandboxMode;
  // Always explicit: omitting the field on resume keeps the thread's previous
  // reviewer, which would leave auto_review sticky after switching modes.
  readonly approvalsReviewer: EffectCodexSchema.V2ThreadStartParams__ApprovalsReviewer;
} {
  switch (input) {
    case "approval-required":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
        approvalsReviewer: "user",
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "user",
      };
    case "auto":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "auto_review",
      };
    case "full-access":
    default:
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        approvalsReviewer: "user",
      };
  }
}

export function buildCodexDynamicTools(
  specs: ReadonlyArray<ExperimentalDynamicToolSpec>,
): ReadonlyArray<CodexDynamicToolSpec> {
  const functions: CodexDynamicToolFunctionSpec[] = [];
  const namespaces = new Map<string, CodexDynamicToolFunctionSpec[]>();

  for (const spec of specs) {
    const tool: CodexDynamicToolFunctionSpec = {
      type: "function",
      name: spec.name,
      description: spec.description,
      inputSchema: spec.inputSchema,
    };
    if (spec.namespace === undefined) {
      functions.push(tool);
      continue;
    }
    const namespaceTools = namespaces.get(spec.namespace);
    if (namespaceTools === undefined) {
      namespaces.set(spec.namespace, [tool]);
    } else {
      namespaceTools.push(tool);
    }
  }

  return [
    ...functions,
    ...[...namespaces].map(([name, tools]) => ({
      type: "namespace" as const,
      name,
      description: `Tools in the '${name}' namespace.`,
      tools,
    })),
  ];
}

function buildThreadStartParams(input: {
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
  readonly model: string | undefined;
  readonly serviceTier: CodexServiceTier | undefined;
  readonly dynamicTools?: ReadonlyArray<CodexDynamicToolSpec>;
}): CodexThreadStartParamsWithDynamicTools {
  const config = runtimeModeToThreadConfig(input.runtimeMode);
  return {
    cwd: input.cwd,
    approvalPolicy: config.approvalPolicy,
    sandbox: config.sandbox,
    approvalsReviewer: config.approvalsReviewer,
    ...(input.model ? { model: input.model } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.dynamicTools && input.dynamicTools.length > 0
      ? { dynamicTools: input.dynamicTools }
      : {}),
  };
}

function runtimeModeToTurnSandboxPolicy(
  input: RuntimeMode,
): EffectCodexSchema.V2TurnStartParams__SandboxPolicy {
  switch (input) {
    case "approval-required":
      return {
        type: "readOnly",
      };
    case "auto-accept-edits":
    case "auto":
      return {
        type: "workspaceWrite",
      };
    case "full-access":
    default:
      return {
        type: "dangerFullAccess",
      };
  }
}

function buildCodexCollaborationMode(input: {
  readonly interactionMode?: ProviderInteractionMode;
  readonly collaborationMode?: CodexSessionRuntimeCollaborationModeInput;
  readonly model?: string;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort;
}): EffectCodexSchema.V2TurnStartParams__CollaborationMode | undefined {
  if (input.collaborationMode !== undefined) {
    const model = normalizeCodexModelSlug(input.model) ?? DEFAULT_MODEL;
    return {
      mode: input.collaborationMode.mode,
      settings: {
        model,
        reasoning_effort: input.effort ?? "medium",
        developer_instructions:
          input.collaborationMode.developerInstructions ??
          (input.collaborationMode.mode === "plan"
            ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
            : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS),
      },
    };
  }
  if (input.interactionMode === undefined) {
    return undefined;
  }
  if (input.interactionMode !== "default" && input.interactionMode !== "plan") {
    throw new Error(
      `Codex interaction mode '${input.interactionMode}' requires registry resolution before provider dispatch.`,
    );
  }
  const model = normalizeCodexModelSlug(input.model) ?? DEFAULT_MODEL;
  const reasoningEffort = input.effort ?? "medium";
  return {
    mode: input.interactionMode,
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: buildCodexDeveloperInstructions(input.interactionMode, {
        model,
        reasoningEffort,
      }),
    },
  };
}

const CODEX_INTERACTION_MODE_CONTEXT_KEY = "upcomputer_interaction_mode";

function buildCodexInteractionModeAdditionalContext(
  collaborationMode: EffectCodexSchema.V2TurnStartParams__CollaborationMode | undefined,
):
  | Readonly<Record<string, EffectCodexSchema.V2TurnStartParams__AdditionalContextEntry>>
  | undefined {
  if (collaborationMode?.mode !== "default") {
    return undefined;
  }
  const instructions = collaborationMode.settings.developer_instructions;
  if (instructions === undefined || instructions === null || instructions.length === 0) {
    return undefined;
  }

  // Codex snapshots collaboration-mode state by native mode. Ask and Build both
  // use native Default, so a change between their developer instructions can be
  // omitted. Application additional context is also developer-role, while its
  // stable key makes Codex re-emit the block only when the instructions change.
  return {
    [CODEX_INTERACTION_MODE_CONTEXT_KEY]: {
      kind: "application",
      value: instructions,
    },
  };
}

export function buildTurnStartParams(input: {
  readonly threadId: string;
  readonly runtimeMode: RuntimeMode;
  readonly prompt?: string;
  readonly attachments?: ReadonlyArray<{
    readonly type: "image";
    readonly url: string;
  }>;
  readonly model?: string;
  readonly serviceTier?: CodexServiceTier;
  readonly effort?: EffectCodexSchema.V2TurnStartParams__ReasoningEffort;
  readonly interactionMode?: ProviderInteractionMode;
  readonly interactionModeSandbox?: InteractionModeSandboxPolicy;
  readonly collaborationMode?: CodexSessionRuntimeCollaborationModeInput;
  readonly supportsInteractionModeAdditionalContext?: boolean;
}): Effect.Effect<
  CodexTurnStartParamsWithCollaborationMode,
  CodexErrors.CodexAppServerProtocolParseError
> {
  const turnInput: Array<EffectCodexSchema.V2TurnStartParams__UserInput> = [];
  if (input.prompt) {
    turnInput.push({
      type: "text",
      text: input.prompt,
    });
  }
  for (const attachment of input.attachments ?? []) {
    turnInput.push(attachment);
  }

  const config = runtimeModeToThreadConfig(input.runtimeMode);
  const collaborationMode = buildCodexCollaborationMode({
    ...(input.collaborationMode ? { collaborationMode: input.collaborationMode } : {}),
    ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
  });
  const additionalContext =
    input.supportsInteractionModeAdditionalContext === false
      ? undefined
      : buildCodexInteractionModeAdditionalContext(collaborationMode);
  const sandboxPolicy =
    input.interactionModeSandbox === "read-only"
      ? ({ type: "readOnly" } satisfies EffectCodexSchema.V2TurnStartParams__SandboxPolicy)
      : runtimeModeToTurnSandboxPolicy(input.runtimeMode);

  return decodeCodexTurnStartParamsWithCollaborationMode({
    threadId: input.threadId,
    input: turnInput,
    approvalPolicy: config.approvalPolicy,
    approvalsReviewer: config.approvalsReviewer,
    // Not runtimeModeToTurnSandboxPolicy(input.runtimeMode) directly: Ask mode
    // pins the turn to read-only regardless of the thread's runtime mode.
    sandboxPolicy,
    ...(input.model ? { model: input.model } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    ...(collaborationMode ? { collaborationMode } : {}),
    ...(additionalContext ? { additionalContext } : {}),
  }).pipe(
    Effect.mapError((cause) =>
      CodexErrors.CodexAppServerProtocolParseError.fromSchemaError(
        "decode-request-payload",
        cause,
        { method: "turn/start" },
      ),
    ),
  );
}

function classifyCodexStderrLine(rawLine: string): { readonly message: string } | null {
  const line = rawLine.replaceAll(ANSI_ESCAPE_REGEX, "").trim();
  if (!line) {
    return null;
  }

  const match = line.match(CODEX_STDERR_LOG_REGEX);
  if (match) {
    const level = match[1];
    if (level && level !== "ERROR") {
      return null;
    }
    if (BENIGN_ERROR_LOG_SNIPPETS.some((snippet) => line.includes(snippet))) {
      return null;
    }
  }

  return { message: line };
}

export function isRecoverableThreadResumeError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!message.includes("thread")) {
    return false;
  }
  return RECOVERABLE_THREAD_RESUME_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}

type CodexThreadOpenResponse =
  | CodexRpc.ClientRequestResponsesByMethod["thread/start"]
  | CodexRpc.ClientRequestResponsesByMethod["thread/resume"];

type CodexThreadOpenMethod = "thread/start" | "thread/resume";

interface CodexThreadOpenClient {
  readonly request: <M extends CodexThreadOpenMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexErrors.CodexAppServerError>;
  readonly raw?: {
    readonly request: (
      method: CodexThreadOpenMethod,
      payload: CodexThreadStartParamsWithDynamicTools | CodexThreadResumeParamsWithDynamicTools,
    ) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>;
  };
}

export const openCodexThread = (input: {
  readonly client: CodexThreadOpenClient;
  readonly threadId: ThreadId;
  readonly runtimeMode: RuntimeMode;
  readonly cwd: string;
  readonly requestedModel: string | undefined;
  readonly serviceTier: CodexServiceTier | undefined;
  readonly resumeThreadId: string | undefined;
  readonly dynamicTools?: ReadonlyArray<CodexDynamicToolSpec>;
}): Effect.Effect<CodexThreadOpenResponse, CodexErrors.CodexAppServerError> => {
  const resumeThreadId = input.resumeThreadId;
  const hasDynamicTools = input.dynamicTools !== undefined && input.dynamicTools.length > 0;
  const startParams = buildThreadStartParams({
    cwd: input.cwd,
    runtimeMode: input.runtimeMode,
    model: input.requestedModel,
    serviceTier: input.serviceTier,
    ...(input.dynamicTools ? { dynamicTools: input.dynamicTools } : {}),
  });
  const decodeThreadStart = (raw: unknown) =>
    decodeV2ThreadStartResponse(raw).pipe(
      Effect.mapError((error) =>
        CodexErrors.CodexAppServerProtocolParseError.fromSchemaError(
          "decode-response-payload",
          error,
          { method: "thread/start" },
        ),
      ),
    );
  const decodeThreadResume = (raw: unknown) =>
    decodeV2ThreadResumeResponse(raw).pipe(
      Effect.mapError((error) =>
        CodexErrors.CodexAppServerProtocolParseError.fromSchemaError(
          "decode-response-payload",
          error,
          { method: "thread/resume" },
        ),
      ),
    );

  if (resumeThreadId === undefined) {
    if (hasDynamicTools && input.client.raw !== undefined) {
      return input.client.raw
        .request("thread/start", startParams)
        .pipe(Effect.flatMap(decodeThreadStart));
    }
    return input.client.request("thread/start", startParams);
  }

  const resumeParams = {
    threadId: resumeThreadId,
    ...startParams,
  } satisfies CodexThreadResumeParamsWithDynamicTools;
  const resume =
    hasDynamicTools && input.client.raw !== undefined
      ? input.client.raw
          .request("thread/resume", resumeParams)
          .pipe(Effect.flatMap(decodeThreadResume))
      : input.client.request("thread/resume", resumeParams);
  const restart =
    hasDynamicTools && input.client.raw !== undefined
      ? input.client.raw
          .request("thread/start", startParams)
          .pipe(Effect.flatMap(decodeThreadStart))
      : input.client.request("thread/start", startParams);

  return resume.pipe(
    Effect.catchIf(isRecoverableThreadResumeError, (error) =>
      Effect.logWarning("codex app-server thread resume fell back to fresh start", {
        threadId: input.threadId,
        requestedRuntimeMode: input.runtimeMode,
        resumeThreadId,
        recoverable: true,
        cause: error,
      }).pipe(Effect.andThen(restart)),
    ),
  );
};

function readNotificationThreadId(notification: CodexServerNotification): string | undefined {
  switch (notification.method) {
    case "thread/started":
      return notification.params.thread.id;
    case "error":
    case "thread/status/changed":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
    case "thread/name/updated":
    case "thread/tokenUsage/updated":
    case "turn/started":
    case "hook/started":
    case "turn/completed":
    case "hook/completed":
    case "turn/diff/updated":
    case "turn/plan/updated":
    case "item/started":
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed":
    case "item/completed":
    case "rawResponseItem/completed":
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "serverRequest/resolved":
    case "item/mcpToolCall/progress":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
    case "thread/compacted":
    case "thread/realtime/started":
    case "thread/realtime/itemAdded":
    case "thread/realtime/transcript/delta":
    case "thread/realtime/transcript/done":
    case "thread/realtime/outputAudio/delta":
    case "thread/realtime/sdp":
    case "thread/realtime/error":
    case "thread/realtime/closed":
      return notification.params.threadId;
    default:
      return undefined;
  }
}

function readRouteFields(notification: CodexServerNotification): {
  readonly turnId: TurnId | undefined;
  readonly itemId: ProviderItemId | undefined;
} {
  switch (notification.method) {
    case "thread/started":
      return {
        turnId: undefined,
        itemId: undefined,
      };
    case "turn/started":
    case "turn/completed":
      return {
        turnId: TurnId.make(notification.params.turn.id),
        itemId: undefined,
      };
    case "error":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: undefined,
      };
    case "turn/diff/updated":
    case "turn/plan/updated":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: undefined,
      };
    case "serverRequest/resolved":
      return {
        turnId: undefined,
        itemId: undefined,
      };
    case "item/started":
    case "item/completed":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: ProviderItemId.make(notification.params.item.id),
      };
    case "item/agentMessage/delta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/commandExecution/terminalInteraction":
    case "item/fileChange/outputDelta":
    case "item/fileChange/patchUpdated":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return {
        turnId: TurnId.make(notification.params.turnId),
        itemId: ProviderItemId.make(notification.params.itemId),
      };
    default:
      return {
        turnId: undefined,
        itemId: undefined,
      };
  }
}

function rememberCollabReceiverTurns(
  collabReceiverTurns: Map<string, TurnId>,
  notification: CodexServerNotification,
  parentTurnId: TurnId | undefined,
): void {
  if (!parentTurnId) {
    return;
  }

  if (notification.method !== "item/started" && notification.method !== "item/completed") {
    return;
  }

  if (notification.params.item.type !== "collabAgentToolCall") {
    return;
  }

  for (const receiverThreadId of notification.params.item.receiverThreadIds) {
    collabReceiverTurns.set(receiverThreadId, parentTurnId);
  }
}

function shouldSuppressChildConversationNotification(
  method: CodexRpc.ServerNotificationMethod,
): boolean {
  return (
    method === "thread/started" ||
    method === "thread/status/changed" ||
    method === "thread/archived" ||
    method === "thread/unarchived" ||
    method === "thread/closed" ||
    method === "thread/compacted" ||
    method === "thread/name/updated" ||
    method === "thread/tokenUsage/updated" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "turn/plan/updated" ||
    method === "item/plan/delta"
  );
}

function toCodexUserInputAnswer(
  questionId: string,
  value: ProviderUserInputAnswers[string],
): Effect.Effect<
  EffectCodexSchema.ToolRequestUserInputResponse__ToolRequestUserInputAnswer,
  CodexSessionRuntimeInvalidUserInputAnswersError
> {
  if (typeof value === "string") {
    return Effect.succeed({ answers: [value] });
  }
  if (Array.isArray(value)) {
    const answers = value.filter((entry): entry is string => typeof entry === "string");
    return Effect.succeed({ answers });
  }
  if (isCodexUserInputAnswerObject(value)) {
    return Effect.succeed({ answers: value.answers });
  }
  return Effect.fail(new CodexSessionRuntimeInvalidUserInputAnswersError({ questionId }));
}

function toCodexUserInputAnswers(
  answers: ProviderUserInputAnswers,
): Effect.Effect<
  EffectCodexSchema.ToolRequestUserInputResponse["answers"],
  CodexSessionRuntimeInvalidUserInputAnswersError
> {
  return Effect.forEach(
    Object.entries(answers),
    ([questionId, value]) =>
      toCodexUserInputAnswer(questionId, value).pipe(
        Effect.map((answer) => [questionId, answer] as const),
      ),
    { concurrency: 1 },
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)));
}

function currentProviderThreadId(session: ProviderSession): string | undefined {
  return readResumeCursorThreadId(session.resumeCursor);
}

function updateSession(
  sessionRef: Ref.Ref<ProviderSession>,
  updates: Partial<ProviderSession>,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Ref.update(sessionRef, (session) => ({
      ...session,
      ...updates,
      updatedAt,
    }));
  });
}

function parseThreadSnapshot(
  response: EffectCodexSchema.V2ThreadReadResponse | EffectCodexSchema.V2ThreadRollbackResponse,
): CodexThreadSnapshot {
  return {
    threadId: response.thread.id,
    turns: response.thread.turns.map((turn) => ({
      id: TurnId.make(turn.id),
      items: turn.items,
    })),
  };
}

export const makeCodexSessionRuntime = (
  options: CodexSessionRuntimeOptions,
): Effect.Effect<
  CodexSessionRuntimeShape,
  CodexErrors.CodexAppServerError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Scope.Scope;
    const crypto = yield* Crypto.Crypto;
    const events = yield* Queue.unbounded<ProviderEvent>();
    const pendingApprovalsRef = yield* Ref.make(new Map<ApprovalRequestId, PendingApproval>());
    const approvalCorrelationsRef = yield* Ref.make(new Map<string, ApprovalCorrelation>());
    const dynamicToolLease: ExperimentalDynamicToolLease<never, never> | undefined =
      options.dynamicToolRegistry?.lease();
    const admittedDynamicToolsRef = yield* Ref.make(new Map<string, string | undefined>());
    const turnDynamicToolPoliciesRef = yield* Ref.make(new Map<string, TurnDynamicToolPolicy>());
    const pendingUserInputsRef = yield* Ref.make(new Map<ApprovalRequestId, PendingUserInput>());
    const collabReceiverTurnsRef = yield* Ref.make(new Map<string, TurnId>());
    const supportsInteractionModeAdditionalContextRef = yield* Ref.make(false);
    const closedRef = yield* Ref.make(false);

    // `~` is not shell-expanded when env vars are set via
    // `child_process.spawn`; `expandHomePath` lets a configured
    // `CODEX_HOME=~/.codex_work` reach codex as an absolute path.
    const resolvedHomePath = options.homePath ? expandHomePath(options.homePath) : undefined;
    const env = {
      ...options.environment,
      ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
    };
    const extendEnv = options.environment === undefined;
    const appServerArgs = codexSessionAppServerArgs(options.appServerArgs, options.launchArgs);
    const spawnCommand = yield* resolveSpawnCommand(options.binaryPath, appServerArgs, {
      env,
      extendEnv,
    });
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd: options.cwd,
          env,
          extendEnv,
          forceKillAfter: CODEX_APP_SERVER_FORCE_KILL_AFTER,
          shell: spawnCommand.shell,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new CodexErrors.CodexAppServerSpawnError({
              command: `${options.binaryPath} app-server`,
              cause,
            }),
        ),
      );

    const clientContext = yield* CodexClient.layerChildProcess(child).pipe(
      Layer.build,
      Effect.provideService(Scope.Scope, runtimeScope),
    );
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );
    const serverNotifications = yield* Queue.unbounded<CodexServerNotification>();
    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = (purpose: CodexErrors.CodexAppServerIdentifierPurpose) =>
      crypto.randomUUIDv4.pipe(
        Effect.mapError(
          (cause) =>
            new CodexErrors.CodexAppServerIdentifierGenerationError({
              purpose,
              cause,
            }),
        ),
      );

    const sessionCreatedAt = yield* nowIso;
    const initialSession = {
      provider: PROVIDER,
      ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
      status: "connecting",
      runtimeMode: options.runtimeMode,
      cwd: options.cwd,
      ...(options.model ? { model: options.model } : {}),
      threadId: options.threadId,
      ...(options.resumeCursor !== undefined ? { resumeCursor: options.resumeCursor } : {}),
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
    } satisfies ProviderSession;
    const sessionRef = yield* Ref.make<ProviderSession>(initialSession);
    const offerEvent = (event: ProviderEvent) => Queue.offer(events, event).pipe(Effect.asVoid);

    const emitEvent = (event: Omit<ProviderEvent, "id" | "provider" | "createdAt">) =>
      Effect.gen(function* () {
        const id = yield* randomUUIDv4("provider-event");
        return yield* offerEvent({
          id: EventId.make(id),
          provider: PROVIDER,
          ...(options.providerInstanceId ? { providerInstanceId: options.providerInstanceId } : {}),
          createdAt: yield* nowIso,
          ...event,
        });
      });
    const emitSessionEvent = (method: string, message: string) =>
      emitEvent({
        kind: "session",
        threadId: options.threadId,
        method,
        message,
      });

    const settlePendingApprovals = (decision: ProviderApprovalDecision) =>
      Ref.get(pendingApprovalsRef).pipe(
        Effect.flatMap((pendingApprovals) =>
          Effect.forEach(
            Array.from(pendingApprovals.values()),
            (pendingApproval) =>
              Deferred.succeed(pendingApproval.decision, decision).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );

    const settlePendingUserInputs = (answers: ProviderUserInputAnswers) =>
      Ref.get(pendingUserInputsRef).pipe(
        Effect.flatMap((pendingUserInputs) =>
          Effect.forEach(
            Array.from(pendingUserInputs.values()),
            (pendingUserInput) =>
              Deferred.succeed(pendingUserInput.answers, answers).pipe(Effect.ignore),
            { discard: true },
          ),
        ),
      );

    const handleRawNotification = (notification: CodexServerNotification) =>
      Effect.gen(function* () {
        const payload = notification.params;
        const route = readRouteFields(notification);
        const collabReceiverTurns = yield* Ref.get(collabReceiverTurnsRef);
        const childParentTurnId = (() => {
          const providerConversationId = readNotificationThreadId(notification);
          return providerConversationId
            ? collabReceiverTurns.get(providerConversationId)
            : undefined;
        })();

        rememberCollabReceiverTurns(collabReceiverTurns, notification, route.turnId);
        if (childParentTurnId && shouldSuppressChildConversationNotification(notification.method)) {
          yield* Ref.set(collabReceiverTurnsRef, collabReceiverTurns);
          return;
        }

        let requestId: ApprovalRequestId | undefined;
        let requestKind: ProviderRequestKind | undefined;
        let turnId = childParentTurnId ?? route.turnId;
        let itemId = route.itemId;

        if (notification.method === "serverRequest/resolved") {
          const rawRequestId =
            typeof notification.params.requestId === "string"
              ? notification.params.requestId
              : String(notification.params.requestId);
          const correlation = rawRequestId
            ? (yield* Ref.get(approvalCorrelationsRef)).get(rawRequestId)
            : undefined;
          if (correlation) {
            requestId = correlation.requestId;
            requestKind = correlation.requestKind;
            turnId = correlation.turnId ?? turnId;
            itemId = correlation.itemId ?? itemId;
            yield* Ref.update(approvalCorrelationsRef, (current) => {
              const next = new Map(current);
              next.delete(rawRequestId);
              return next;
            });
          }
        }

        yield* Ref.set(collabReceiverTurnsRef, collabReceiverTurns);
        yield* emitEvent({
          kind: "notification",
          threadId: options.threadId,
          method: notification.method,
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          ...(requestId ? { requestId } : {}),
          ...(requestKind ? { requestKind } : {}),
          ...(notification.method === "item/agentMessage/delta"
            ? { textDelta: notification.params.delta }
            : {}),
          ...(payload !== undefined ? { payload } : {}),
        });
      });

    const currentSessionProviderThreadId = Effect.map(Ref.get(sessionRef), currentProviderThreadId);

    yield* client.handleServerNotification("thread/started", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.thread.id !== providerThreadId) {
            return Effect.void;
          }
          return updateSession(sessionRef, {
            resumeCursor: { threadId: payload.thread.id },
          });
        }),
      ),
    );

    yield* client.handleServerNotification("turn/started", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.threadId !== providerThreadId) {
            return Effect.void;
          }
          return updateSession(sessionRef, {
            status: "running",
            activeTurnId: TurnId.make(payload.turn.id),
          });
        }),
      ),
    );

    yield* client.handleServerNotification("turn/completed", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          if (providerThreadId && payload.threadId !== providerThreadId) {
            return Effect.void;
          }
          const lastError =
            payload.turn.status === "failed" && "error" in payload.turn && payload.turn.error
              ? payload.turn.error.message
              : undefined;
          return Ref.update(turnDynamicToolPoliciesRef, (current) => {
            const next = new Map(current);
            next.delete(payload.turn.id);
            return next;
          }).pipe(
            Effect.andThen(
              updateSession(sessionRef, {
                status: payload.turn.status === "failed" ? "error" : "ready",
                activeTurnId: undefined,
                ...(lastError ? { lastError } : {}),
              }),
            ),
          );
        }),
      ),
    );

    yield* client.handleServerNotification("error", (payload) =>
      currentSessionProviderThreadId.pipe(
        Effect.flatMap((providerThreadId) => {
          const payloadThreadId = payload.threadId;
          if (providerThreadId && payloadThreadId && payloadThreadId !== providerThreadId) {
            return Effect.void;
          }
          const errorMessage = payload.error.message;
          const willRetry = payload.willRetry;
          return updateSession(sessionRef, {
            status: willRetry ? "running" : "error",
            ...(errorMessage ? { lastError: errorMessage } : {}),
          });
        }),
      ),
    );

    yield* client.handleServerRequest("item/commandExecution/requestApproval", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(yield* randomUUIDv4("command-approval-request"));
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const decision = yield* Deferred.make<ProviderApprovalDecision>();

        yield* Ref.update(pendingApprovalsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            jsonRpcId: payload.approvalId ?? payload.itemId,
            requestKind: "command",
            turnId,
            itemId,
            decision,
          });
          return next;
        });
        yield* Ref.update(approvalCorrelationsRef, (current) => {
          const next = new Map(current);
          next.set(payload.approvalId ?? payload.itemId, {
            requestId,
            requestKind: "command",
            turnId,
            itemId,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/commandExecution/requestApproval",
          requestId,
          requestKind: "command",
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolved = yield* Deferred.await(decision).pipe(
          Effect.ensuring(
            Ref.update(pendingApprovalsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );
        return {
          decision: resolved,
        } satisfies EffectCodexSchema.CommandExecutionRequestApprovalResponse;
      }),
    );

    yield* client.handleServerRequest("item/fileChange/requestApproval", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(
          yield* randomUUIDv4("file-change-approval-request"),
        );
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const decision = yield* Deferred.make<ProviderApprovalDecision>();

        yield* Ref.update(pendingApprovalsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            jsonRpcId: payload.itemId,
            requestKind: "file-change",
            turnId,
            itemId,
            decision,
          });
          return next;
        });
        yield* Ref.update(approvalCorrelationsRef, (current) => {
          const next = new Map(current);
          next.set(payload.itemId, {
            requestId,
            requestKind: "file-change",
            turnId,
            itemId,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/fileChange/requestApproval",
          requestId,
          requestKind: "file-change",
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolved = yield* Deferred.await(decision).pipe(
          Effect.ensuring(
            Ref.update(pendingApprovalsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );
        return {
          decision: resolved,
        } satisfies EffectCodexSchema.FileChangeRequestApprovalResponse;
      }),
    );

    yield* client.handleServerRequest("item/tool/requestUserInput", (payload) =>
      Effect.gen(function* () {
        const requestId = ApprovalRequestId.make(yield* randomUUIDv4("user-input-request"));
        const turnId = TurnId.make(payload.turnId);
        const itemId = ProviderItemId.make(payload.itemId);
        const answers = yield* Deferred.make<ProviderUserInputAnswers>();

        yield* Ref.update(pendingUserInputsRef, (current) => {
          const next = new Map(current);
          next.set(requestId, {
            requestId,
            turnId,
            itemId,
            answers,
          });
          return next;
        });

        yield* emitEvent({
          kind: "request",
          threadId: options.threadId,
          method: "item/tool/requestUserInput",
          requestId,
          ...(turnId ? { turnId } : {}),
          ...(itemId ? { itemId } : {}),
          payload,
        });

        const resolvedAnswers = yield* Deferred.await(answers).pipe(
          Effect.ensuring(
            Ref.update(pendingUserInputsRef, (current) => {
              const next = new Map(current);
              next.delete(requestId);
              return next;
            }),
          ),
        );

        return {
          answers: yield* toCodexUserInputAnswers(resolvedAnswers).pipe(
            Effect.mapError((error) =>
              CodexErrors.CodexAppServerRequestError.invalidParams(error.message, {
                questionId: error.questionId,
              }),
            ),
          ),
        } satisfies EffectCodexSchema.ToolRequestUserInputResponse;
      }),
    );

    yield* client.handleServerRequest("item/tool/call", (payload) =>
      Effect.gen(function* () {
        const args = isRecord(payload.arguments) ? payload.arguments : {};
        const admittedDynamicTools = yield* Ref.get(admittedDynamicToolsRef);
        const admittedNamespace = admittedDynamicTools.get(payload.tool);
        const payloadNamespace = payload.namespace ?? undefined;
        const registeredSpec = dynamicToolLease?.specs.find(
          (spec) =>
            admittedDynamicTools.has(payload.tool) &&
            spec.name === payload.tool &&
            spec.namespace === admittedNamespace &&
            (spec.namespace === undefined || payloadNamespace === spec.namespace),
        );

        if (registeredSpec === undefined || dynamicToolLease === undefined) {
          return {
            success: false,
            contentItems: [
              {
                type: "inputText",
                text: `Unknown dynamic tool: ${payload.tool}.`,
              },
            ],
          } satisfies EffectCodexSchema.DynamicToolCallResponse;
        }

        const turnPolicy = (yield* Ref.get(turnDynamicToolPoliciesRef)).get(payload.turnId);
        const resultExit = yield* Effect.exit(
          dynamicToolLease.execute(payload.tool, args, {
            source: "provider",
            mutationPolicy: turnPolicy?.mutationPolicy ?? "deny",
            threadId: options.threadId,
            turnId: TurnId.make(payload.turnId),
            ...(options.providerInstanceId
              ? { providerInstanceId: options.providerInstanceId }
              : {}),
            runtimeMode: options.runtimeMode,
            ...(turnPolicy?.interactionMode ? { interactionMode: turnPolicy.interactionMode } : {}),
          }),
        );

        if (Exit.isFailure(resultExit)) {
          yield* Effect.logError("Dynamic tool execution failed", {
            ownerNamespace: registeredSpec.namespace ?? null,
            toolName: payload.tool,
            cause: resultExit.cause,
          });
          return {
            success: false,
            contentItems: [{ type: "inputText", text: `Dynamic tool '${payload.tool}' failed.` }],
          } satisfies EffectCodexSchema.DynamicToolCallResponse;
        }

        return {
          success: !resultExit.value.isError,
          contentItems: [{ type: "inputText", text: resultExit.value.text }],
        } satisfies EffectCodexSchema.DynamicToolCallResponse;
      }),
    );

    yield* client.handleUnknownServerRequest((method) =>
      Effect.fail(CodexErrors.CodexAppServerRequestError.methodNotFound(method)),
    );

    const registerServerNotification = <M extends CodexRpc.ServerNotificationMethod>(method: M) =>
      client.handleServerNotification(method, (params) =>
        Queue.offer(serverNotifications, makeCodexServerNotification(method, params)).pipe(
          Effect.asVoid,
        ),
      );

    yield* Effect.forEach(
      Object.values(
        CodexRpc.SERVER_NOTIFICATION_METHODS,
      ) as ReadonlyArray<CodexRpc.ServerNotificationMethod>,
      registerServerNotification,
      { concurrency: 1, discard: true },
    );

    yield* Stream.fromQueue(serverNotifications).pipe(
      Stream.runForEach(handleRawNotification),
      Effect.forkIn(runtimeScope),
    );

    const stderrRemainderRef = yield* Ref.make("");
    yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.modify(stderrRemainderRef, (current) => {
          const combined = current + chunk;
          const lines = combined.split("\n");
          const remainder = lines.pop() ?? "";
          return [lines.map((line) => line.replace(/\r$/, "")), remainder] as const;
        }).pipe(
          Effect.flatMap((lines) =>
            Effect.forEach(
              lines,
              (line) => {
                const classified = classifyCodexStderrLine(line);
                if (!classified) {
                  return Effect.void;
                }
                return emitEvent({
                  kind: "notification",
                  threadId: options.threadId,
                  method: "process/stderr",
                  message: classified.message,
                });
              },
              { discard: true },
            ),
          ),
        ),
      ),
      Effect.forkIn(runtimeScope),
    );

    yield* child.exitCode.pipe(
      Effect.flatMap((exitCode) =>
        Ref.get(closedRef).pipe(
          Effect.flatMap((closed) => {
            if (closed) {
              return Effect.void;
            }
            const nextStatus = exitCode === 0 ? "closed" : "error";
            return updateSession(sessionRef, {
              status: nextStatus,
              activeTurnId: undefined,
            }).pipe(
              Effect.andThen(
                emitSessionEvent(
                  "session/exited",
                  exitCode === 0
                    ? "Codex App Server exited."
                    : `Codex App Server exited with code ${exitCode}.`,
                ),
              ),
            );
          }),
        ),
      ),
      Effect.forkIn(runtimeScope),
    );

    const start = Effect.fn("CodexSessionRuntime.start")(function* () {
      yield* emitSessionEvent("session/connecting", "Starting Codex App Server session.");
      const initialize = yield* client.request("initialize", buildCodexInitializeParams());
      yield* client.notify("initialized", undefined);
      yield* Ref.set(
        supportsInteractionModeAdditionalContextRef,
        supportsCodexInteractionModeAdditionalContext(
          codexVersionFromUserAgent(initialize.userAgent),
        ),
      );

      const requestedModel = normalizeCodexModelSlug(options.model);
      const registeredDynamicTools = dynamicToolLease?.specs ?? [];
      yield* Ref.set(
        admittedDynamicToolsRef,
        new Map(registeredDynamicTools.map((spec) => [spec.name, spec.namespace] as const)),
      );

      const opened = yield* openCodexThread({
        client,
        threadId: options.threadId,
        runtimeMode: options.runtimeMode,
        cwd: options.cwd,
        requestedModel,
        serviceTier: options.serviceTier,
        resumeThreadId: readResumeCursorThreadId(options.resumeCursor),
        dynamicTools: buildCodexDynamicTools(registeredDynamicTools),
      });

      const providerThreadId = opened.thread.id;
      const session = {
        ...(yield* Ref.get(sessionRef)),
        status: "ready",
        cwd: opened.cwd,
        model: opened.model,
        resumeCursor: { threadId: providerThreadId },
        updatedAt: yield* nowIso,
      } satisfies ProviderSession;
      yield* Ref.set(sessionRef, session);
      yield* emitSessionEvent("session/ready", "Codex App Server session ready.");
      return session;
    });

    const readProviderThreadId = Effect.gen(function* () {
      const providerThreadId = currentProviderThreadId(yield* Ref.get(sessionRef));
      if (!providerThreadId) {
        return yield* new CodexSessionRuntimeThreadIdMissingError({
          threadId: options.threadId,
        });
      }
      return providerThreadId;
    });

    const close = Effect.gen(function* () {
      const alreadyClosed = yield* Ref.getAndSet(closedRef, true);
      if (alreadyClosed) {
        return;
      }
      yield* settlePendingApprovals("cancel");
      yield* settlePendingUserInputs({});
      yield* updateSession(sessionRef, {
        status: "closed",
        activeTurnId: undefined,
      });
      yield* emitSessionEvent("session/closed", "Session stopped").pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to emit Codex session closed event.", { cause }),
        ),
      );
      yield* Scope.close(runtimeScope, Exit.void);
      yield* Queue.shutdown(serverNotifications);
      yield* Queue.shutdown(events);
    });

    return {
      start,
      getSession: Ref.get(sessionRef),
      sendTurn: (input) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          if (hasConfiguredMcpServer(options.appServerArgs)) {
            yield* client.request("config/mcpServer/reload", undefined).pipe(
              Effect.catch((cause) =>
                Effect.logWarning("Failed to refresh Codex MCP tool catalog before turn.", {
                  cause,
                }),
              ),
            );
          }
          const normalizedModel = normalizeCodexModelSlug(
            input.model ?? (yield* Ref.get(sessionRef)).model,
          );
          const supportsInteractionModeAdditionalContext = yield* Ref.get(
            supportsInteractionModeAdditionalContextRef,
          );
          const params = yield* buildTurnStartParams({
            threadId: providerThreadId,
            runtimeMode: options.runtimeMode,
            ...(input.input ? { prompt: input.input } : {}),
            ...(input.attachments ? { attachments: input.attachments } : {}),
            ...(normalizedModel ? { model: normalizedModel } : {}),
            ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
            ...(input.effort ? { effort: input.effort } : {}),
            ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
            ...(input.interactionModeSandbox
              ? { interactionModeSandbox: input.interactionModeSandbox }
              : {}),
            ...(input.collaborationMode ? { collaborationMode: input.collaborationMode } : {}),
            supportsInteractionModeAdditionalContext,
          });
          const rawResponse = yield* client.raw.request("turn/start", params);
          const response = yield* decodeV2TurnStartResponse(rawResponse).pipe(
            Effect.mapError((error) =>
              CodexErrors.CodexAppServerProtocolParseError.fromSchemaError(
                "decode-response-payload",
                error,
                { method: "turn/start" },
              ),
            ),
          );
          const turnId = TurnId.make(response.turn.id);
          yield* Ref.update(turnDynamicToolPoliciesRef, (current) => {
            const next = new Map(current);
            next.set(response.turn.id, {
              mutationPolicy: input.mutationPolicy ?? "deny",
              ...(input.interactionMode ? { interactionMode: input.interactionMode } : {}),
            });
            return next;
          });
          yield* updateSession(sessionRef, {
            status: "running",
            activeTurnId: turnId,
            ...(normalizedModel ? { model: normalizedModel } : {}),
          });
          const resumedProviderThreadId = currentProviderThreadId(yield* Ref.get(sessionRef));
          return {
            threadId: options.threadId,
            turnId,
            ...(resumedProviderThreadId
              ? { resumeCursor: { threadId: resumedProviderThreadId } }
              : {}),
          } satisfies ProviderTurnStartResult;
        }),
      interruptTurn: (turnId) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const session = yield* Ref.get(sessionRef);
          const effectiveTurnId = turnId ?? session.activeTurnId;
          if (!effectiveTurnId) {
            return;
          }
          yield* client.request("turn/interrupt", {
            threadId: providerThreadId,
            turnId: effectiveTurnId,
          });
        }),
      readThread: Effect.gen(function* () {
        const providerThreadId = yield* readProviderThreadId;
        const response = yield* client.request("thread/read", {
          threadId: providerThreadId,
          includeTurns: true,
        });
        return parseThreadSnapshot(response);
      }),
      rollbackThread: (numTurns) =>
        Effect.gen(function* () {
          const providerThreadId = yield* readProviderThreadId;
          const response = yield* client.request("thread/rollback", {
            threadId: providerThreadId,
            numTurns,
          });
          yield* updateSession(sessionRef, {
            status: "ready",
            activeTurnId: undefined,
          });
          return parseThreadSnapshot(response);
        }),
      respondToRequest: (requestId, decision) =>
        Effect.gen(function* () {
          const pending = (yield* Ref.get(pendingApprovalsRef)).get(requestId);
          if (!pending) {
            return yield* new CodexSessionRuntimePendingApprovalNotFoundError({
              requestId,
            });
          }
          yield* Ref.update(pendingApprovalsRef, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          yield* Deferred.succeed(pending.decision, decision);
          yield* emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "item/requestApproval/decision",
            requestId: pending.requestId,
            requestKind: pending.requestKind,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
            ...(pending.itemId ? { itemId: pending.itemId } : {}),
            payload: {
              requestId: pending.requestId,
              requestKind: pending.requestKind,
              decision,
            },
          });
        }),
      respondToUserInput: (requestId, answers) =>
        Effect.gen(function* () {
          const pending = (yield* Ref.get(pendingUserInputsRef)).get(requestId);
          if (!pending) {
            return yield* new CodexSessionRuntimePendingUserInputNotFoundError({
              requestId,
            });
          }
          const codexAnswers = yield* toCodexUserInputAnswers(answers);
          yield* Ref.update(pendingUserInputsRef, (current) => {
            const next = new Map(current);
            next.delete(requestId);
            return next;
          });
          yield* Deferred.succeed(pending.answers, answers);
          yield* emitEvent({
            kind: "notification",
            threadId: options.threadId,
            method: "item/tool/requestUserInput/answered",
            requestId: pending.requestId,
            ...(pending.turnId ? { turnId: pending.turnId } : {}),
            ...(pending.itemId ? { itemId: pending.itemId } : {}),
            payload: {
              answers: codexAnswers,
            },
          });
        }),
      events: Stream.fromQueue(events),
      close,
    } satisfies CodexSessionRuntimeShape;
  });
