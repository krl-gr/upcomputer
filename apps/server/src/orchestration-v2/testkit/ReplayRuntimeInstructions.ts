import type { ProviderDriverKind, ProviderReplayTranscript } from "@t3tools/contracts";

import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";
import { UPCOMPUTER_PRODUCT_NAME } from "@t3tools/shared/upcomputerIdentity";

export function materializeReplayTranscriptRuntimeInstructions(
  transcript: ProviderReplayTranscript,
  runtime: { readonly driver: ProviderDriverKind; readonly model: string },
): ProviderReplayTranscript {
  if (runtime.driver === "muse") return rebrandMuseRuntimeInstructions(transcript);
  const harness =
    runtime.driver === "cursor"
      ? "Cursor"
      : runtime.driver === "grok"
        ? "Grok"
        : runtime.driver === "acpRegistry"
          ? "acpRegistry"
          : undefined;
  if (harness === undefined) return transcript;
  const instructions = buildRuntimeInstructions({ harness, model: runtime.model });

  return {
    ...transcript,
    entries: transcript.entries.map((entry) => {
      if (entry.type !== "expect_outbound") return entry;
      const frame = entry.frame;
      if (typeof frame !== "object" || frame === null) return entry;
      if (
        runtime.driver === "cursor" &&
        "type" in frame &&
        frame.type === "run.start" &&
        "message" in frame &&
        typeof frame.message === "string"
      ) {
        return frame.message.endsWith(instructions)
          ? entry
          : { ...entry, frame: { ...frame, message: `${frame.message}\n\n${instructions}` } };
      }
      if (
        "method" in frame &&
        frame.method === "session/prompt" &&
        "params" in frame &&
        typeof frame.params === "object" &&
        frame.params !== null &&
        "prompt" in frame.params &&
        Array.isArray(frame.params.prompt)
      ) {
        const prompt: ReadonlyArray<unknown> = frame.params.prompt;
        const lastPart = prompt.at(-1);
        if (
          typeof lastPart === "object" &&
          lastPart !== null &&
          "type" in lastPart &&
          lastPart.type === "text" &&
          "text" in lastPart &&
          lastPart.text === instructions
        ) {
          return entry;
        }
        return {
          ...entry,
          frame: {
            ...frame,
            params: { ...frame.params, prompt: [...prompt, { type: "text", text: instructions }] },
          },
        };
      }
      return entry;
    }),
  };
}

/**
 * Upstream recorded the Muse fixtures with its own product name in each turn's
 * runtime instructions; Up.computer's instructions name Up.computer.
 */
function rebrandMuseRuntimeInstructions(
  transcript: ProviderReplayTranscript,
): ProviderReplayTranscript {
  return {
    ...transcript,
    entries: transcript.entries.map((entry) => {
      if (entry.type !== "expect_outbound") return entry;
      const frame = entry.frame;
      if (
        typeof frame !== "object" ||
        frame === null ||
        !("method" in frame) ||
        frame.method !== "turn/start" ||
        !("params" in frame) ||
        typeof frame.params !== "object" ||
        frame.params === null ||
        !("input" in frame.params) ||
        !Array.isArray(frame.params.input)
      ) {
        return entry;
      }
      const input: ReadonlyArray<unknown> = frame.params.input;
      return {
        ...entry,
        frame: {
          ...frame,
          params: {
            ...frame.params,
            input: input.map((part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string" &&
              part.text.startsWith("<runtime_info>")
                ? { ...part, text: part.text.replaceAll("T3 Code", UPCOMPUTER_PRODUCT_NAME) }
                : part,
            ),
          },
        },
      };
    }),
  };
}
