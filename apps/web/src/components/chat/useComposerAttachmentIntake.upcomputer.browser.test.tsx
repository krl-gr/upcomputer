import { useEffect } from "react";
import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import {
  type ComposerImageAttachment,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { readConfirmDialogState, subscribeConfirmDialogHost } from "../../confirmDialog";
import { imageContextReference } from "../../lib/composerContextRecords";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { useComposerAttachmentIntake } from "./useComposerAttachmentIntake";

type IntakeInput = Parameters<typeof useComposerAttachmentIntake>[0];
type Intake = ReturnType<typeof useComposerAttachmentIntake>;

function Harness({ input, ready }: { input: IntakeInput; ready: (value: Intake) => void }) {
  const intake = useComposerAttachmentIntake(input);
  useEffect(() => ready(intake));
  return null;
}

it("removes a referenced image and its references without asking", async () => {
  const target = DraftId.make("intake-remove-referenced");
  const store = useComposerDraftStore.getState();
  using _draft = { [Symbol.dispose]: () => store.clearComposerContent(target) };
  // A mounted themed host would show the old confirmation.
  const unsubscribeHost = subscribeConfirmDialogHost(() => {});
  using _host = { [Symbol.dispose]: unsubscribeHost };

  const file = new File([new Uint8Array(4)], "shot.png", { type: "image/png" });
  const image: ComposerImageAttachment = {
    type: "image",
    id: "img-1",
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: "blob:img-1",
    file,
  };
  const chip = formatInlineContextReference(imageContextReference(image));
  store.setPrompt(target, `see ${chip} and ${chip} ok`);
  store.addImages(target, [image]);
  const draft = () => useComposerDraftStore.getState().getComposerDraft(target);

  const input = {
    activeThreadId: ThreadId.make("thread"),
    activePendingProgress: null,
    activePendingIsResponding: false,
    pendingUserInputs: [],
    supportsQuestionAttachments: false,
    isLiteralPendingAnswer: false,
    projectSelectionRequired: false,
    questionAttachmentTarget: null,
    attachmentTargetKey: target,
    fileStagingLimit: null,
    promptRef: { current: draft()?.prompt ?? "" },
    composerImagesRef: { current: draft()?.images ?? [] },
    composerFilesRef: { current: [] },
    composerEditorRef: { current: null },
    isRevertingCheckpointRef: { current: false },
    setThreadError: () => {},
    countReservedAttachments: () => 0,
    addComposerImage: () => [],
    addComposerImagesToDraft: () => [],
    addComposerFilesToDraft: () => [],
    removeComposerImageFromDraft: (id) => store.removeImage(target, id),
    insertAttachmentReferences: () => false,
  } satisfies IntakeInput;
  let intake!: Intake;
  await using _screen = await render(
    <Harness
      input={input}
      ready={(value) => {
        intake = value;
      }}
    />,
  );

  intake.removeComposerImage(image.id);

  expect(readConfirmDialogState().status).toBe("idle");
  expect(draft()?.images ?? []).toEqual([]);
  expect(draft()?.prompt).toBe("see and ok");
});
