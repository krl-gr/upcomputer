import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";

/**
 * Error class names product telemetry may carry. A constructor name or `_tag`
 * outside this list is sent as `other`: classes can be defined by dependencies
 * or built at runtime, and only names written here are known to be safe.
 */
export const APP_ERROR_CLASSES = [
  // JavaScript and the web platform
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DOMException",
  "AbortError",
  // Effect
  "UnknownError",
  "NoSuchElementError",
  "TimeoutError",
  "IllegalArgumentError",
  "ExceededCapacityError",
  "AsyncFiberError",
  "PlatformError",
  "SchemaError",
  "HttpClientError",
  "HttpServerError",
  "RpcClientError",
  "SocketError",
  "SqlError",
  // Ours, at process and session boundaries
  "ProviderAdapterOpenSessionError",
  "ProviderSetupError",
  "BackendProcessExitStatusError",
] as const;

export const AppErrorClass = Schema.Literals([...APP_ERROR_CLASSES, "other"]);
export type AppErrorClass = typeof AppErrorClass.Type;

export const AppErrorKind = Schema.Literals([
  "uncaught",
  "unhandled_rejection",
  "boundary",
  "defect",
]);
export type AppErrorKind = typeof AppErrorKind.Type;

export const AppErrorWhere = Schema.Literals(["server", "web", "desktop"]);
export type AppErrorWhere = typeof AppErrorWhere.Type;

/** A bundle or source file name, never a path. `node` stands for Node's own modules. */
export const APP_ERROR_MODULE_PATTERN = /^[A-Za-z0-9_.@-]{1,80}$/;
const APP_ERROR_STACK_HASH_PATTERN = /^[0-9a-f]{16}$/;

/** What `app.error` carries about one error: a class, a file name and a hash, never text. */
export const AppErrorFingerprint = Schema.Struct({
  errorClass: AppErrorClass,
  module: Schema.optionalKey(Schema.String.check(Schema.isPattern(APP_ERROR_MODULE_PATTERN))),
  stackHash: Schema.String.check(Schema.isPattern(APP_ERROR_STACK_HASH_PATTERN)),
});
export type AppErrorFingerprint = typeof AppErrorFingerprint.Type;

export const AppErrorReport = Schema.Struct({
  ...AppErrorFingerprint.fields,
  kind: AppErrorKind,
});
export type AppErrorReport = typeof AppErrorReport.Type;

/** Signals a desktop backend can die from; anything else is `other`. */
export const DESKTOP_BACKEND_EXIT_SIGNALS = [
  "SIGTERM",
  "SIGKILL",
  "SIGINT",
  "SIGHUP",
  "SIGQUIT",
  "SIGABRT",
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGFPE",
  "SIGTRAP",
  "SIGPIPE",
] as const;
export const DesktopBackendExitSignal = Schema.Literals([...DESKTOP_BACKEND_EXIT_SIGNALS, "other"]);
export type DesktopBackendExitSignal = typeof DesktopBackendExitSignal.Type;

/** Electron's `RenderProcessGoneDetails.reason`. */
export const DesktopRendererGoneReason = Schema.Literals([
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "memory-eviction",
]);
export const DesktopRendererSurface = Schema.Literals([
  "main",
  "preview",
  "splash",
  "picture-in-picture",
  "devtools",
]);

/**
 * Product events the desktop app's main process records through its primary
 * backend, which owns the install's telemetry identity and opt-out.
 */
export const DesktopProductEvent = Schema.Union([
  Schema.Struct({ event: Schema.Literal("app.error"), ...AppErrorReport.fields }),
  Schema.Struct({
    /** The backend process ended without the app asking it to. */
    event: Schema.Literal("desktop.backend.exited"),
    /** The app's own backend, or one it runs elsewhere, such as in WSL. */
    instance: Schema.Literals(["primary", "other"]),
    /** Null when a signal ended it. */
    code: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
    signal: Schema.NullOr(DesktopBackendExitSignal),
    uptimeMs: NonNegativeInt,
    wasReady: Schema.Boolean,
    restarted: Schema.Boolean,
  }),
  Schema.Struct({
    event: Schema.Literal("desktop.renderer.gone"),
    reason: DesktopRendererGoneReason,
    surface: DesktopRendererSurface,
    exitCode: Schema.Int,
  }),
]);
export type DesktopProductEvent = typeof DesktopProductEvent.Type;
