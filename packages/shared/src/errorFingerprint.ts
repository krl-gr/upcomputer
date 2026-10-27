import {
  APP_ERROR_CLASSES,
  APP_ERROR_MODULE_PATTERN,
  type AppErrorClass,
  type AppErrorFingerprint,
} from "@t3tools/contracts";

const KNOWN_ERROR_CLASSES: ReadonlySet<string> = new Set(APP_ERROR_CLASSES);
const MAX_FRAMES = 12;
// V8: "    at fn (location)" or "    at location". Firefox and Safari: "fn@location".
const V8_FRAME = /^\s*at (?:(?:async|new) )?(?:(.*?) \((.*)\)|(.*))$/;
const GECKO_FRAME = /^\s*([^@\s]*)@(.+)$/;
const LINE_AND_COLUMN = /(?::\d+){1,2}$/;
// A bundler's content hash changes with every build, so the hash leaves it out.
const CONTENT_HASH = /-[A-Za-z0-9_-]{8}(?=\.[cm]?js$)/;

interface StackFrame {
  readonly fn: string;
  readonly module: string | undefined;
}

/** A constructor name or `_tag` from the whitelist, otherwise `other`. */
export function errorClassOf(error: unknown): AppErrorClass {
  if (typeof error !== "object" || error === null) return "other";
  const tag = (error as { readonly _tag?: unknown })._tag;
  const name = typeof tag === "string" ? tag : error.constructor?.name;
  return name !== undefined && KNOWN_ERROR_CLASSES.has(name) ? (name as AppErrorClass) : "other";
}

/** The file name of a frame's location, without its directory, query or position. */
function moduleOf(location: string): string | undefined {
  const trimmed = location.trim();
  if (trimmed.startsWith("node:") || trimmed === "native") return "node";
  const withoutPosition = trimmed.replace(LINE_AND_COLUMN, "");
  const withoutQuery = withoutPosition.replace(/[?#].*$/, "");
  const name = withoutQuery.split(/[/\\]/).pop() ?? "";
  return APP_ERROR_MODULE_PATTERN.test(name) ? name : undefined;
}

function parseV8Frame(line: string): StackFrame | undefined {
  const match = V8_FRAME.exec(line);
  if (!match) return undefined;
  // "at <anonymous>" and eval frames carry no file.
  return { fn: match[1] ?? "", module: moduleOf(match[2] ?? match[3] ?? "") };
}

function parseGeckoFrame(line: string): StackFrame | undefined {
  const match = GECKO_FRAME.exec(line);
  return match ? { fn: match[1] ?? "", module: moduleOf(match[2] ?? "") } : undefined;
}

function stackFrames(error: unknown): ReadonlyArray<StackFrame> {
  const stack =
    typeof error === "object" && error !== null
      ? (error as { readonly stack?: unknown }).stack
      : undefined;
  if (typeof stack !== "string") return [];
  const lines = stack.split("\n");
  // A V8 stack starts with the message, which can span lines and look like a
  // Gecko frame; only "at" lines are read from it.
  const parse = lines.some((line) => V8_FRAME.test(line)) ? parseV8Frame : parseGeckoFrame;
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const frame = parse(line);
    if (frame) frames.push(frame);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

/** 64-bit cyrb53-style string hash as 16 hex digits; the same everywhere, no crypto needed. */
function hash64(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * The parts of an error product telemetry may send. The message and stack text
 * never leave this function: the hash covers the class and each frame's function
 * and file name, so line numbers and install paths do not split one error into
 * several across machines.
 */
export function fingerprintError(error: unknown): AppErrorFingerprint {
  const errorClass = errorClassOf(error);
  const frames = stackFrames(error);
  const module = frames.find(
    (frame) => frame.module !== undefined && frame.module !== "node",
  )?.module;
  const normalized = frames.map(
    (frame) => `${frame.fn}@${frame.module?.replace(CONTENT_HASH, "") ?? "?"}`,
  );
  return {
    errorClass,
    ...(module === undefined ? {} : { module }),
    stackHash: hash64([errorClass, ...normalized].join("\n")),
  };
}
