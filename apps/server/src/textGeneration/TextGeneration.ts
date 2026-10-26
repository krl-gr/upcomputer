import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";
import {
  isDefaultTextGenerationModelSelection,
  resolveReadyTextGenerationModelSelection,
} from "@t3tools/shared/serverSettings";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ReviewGuideGenerationInput,
  ReviewGuideGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateReviewGuide";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const withReadySelection = <Input extends { readonly modelSelection: ModelSelection }>(
    input: Input,
  ): Effect.Effect<Input> =>
    isDefaultTextGenerationModelSelection(input.modelSelection)
      ? registry.listInstances.pipe(
          Effect.flatMap((instances) =>
            Effect.forEach(instances, (instance) =>
              instance.snapshot.getSnapshot.pipe(
                Effect.map((snapshot) => ({ ...snapshot, instanceId: instance.instanceId })),
              ),
            ),
          ),
          Effect.map((providers) => ({
            ...input,
            modelSelection: resolveReadyTextGenerationModelSelection(
              input.modelSelection,
              providers,
            ),
          })),
        )
      : Effect.succeed(input);
  return TextGeneration.of({
    generateCommitMessage: Effect.fn("TextGeneration.generateCommitMessage")(function* (requested) {
      const input = yield* withReadySelection(requested);
      const textGeneration = yield* resolveInstance(
        registry,
        "generateCommitMessage",
        input.modelSelection.instanceId,
      );
      return yield* textGeneration.generateCommitMessage(input);
    }),
    generatePrContent: Effect.fn("TextGeneration.generatePrContent")(function* (requested) {
      const input = yield* withReadySelection(requested);
      const textGeneration = yield* resolveInstance(
        registry,
        "generatePrContent",
        input.modelSelection.instanceId,
      );
      return yield* textGeneration.generatePrContent(input);
    }),
    generateBranchName: Effect.fn("TextGeneration.generateBranchName")(function* (requested) {
      const input = yield* withReadySelection(requested);
      const textGeneration = yield* resolveInstance(
        registry,
        "generateBranchName",
        input.modelSelection.instanceId,
      );
      return yield* textGeneration.generateBranchName(input);
    }),
    generateReviewGuide: Effect.fn("TextGeneration.generateReviewGuide")(function* (requested) {
      const input = yield* withReadySelection(requested);
      const textGeneration = yield* resolveInstance(
        registry,
        "generateReviewGuide",
        input.modelSelection.instanceId,
      );
      return yield* textGeneration.generateReviewGuide(input);
    }),
    generateThreadTitle: Effect.fn("TextGeneration.generateThreadTitle")(function* (requested) {
      const input = yield* withReadySelection(requested);
      const textGeneration = yield* resolveInstance(
        registry,
        "generateThreadTitle",
        input.modelSelection.instanceId,
      );
      const linkedContext =
        input.linkedContext ??
        (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
          Effect.provideService(
            SourceControlProviderRegistry.SourceControlProviderRegistry,
            sourceControl,
          ),
        ));
      return yield* textGeneration.generateThreadTitle({ ...input, linkedContext });
    }),
  });
});

export const layer = Layer.effect(TextGeneration, make);
