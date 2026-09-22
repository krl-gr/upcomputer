import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@upcomputer/contracts";
import type { AtomCommandResult } from "@upcomputer/client-runtime/state/runtime";

import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
}

export async function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E>> {
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      ...(input.url === undefined ? {} : { url: input.url }),
    },
  });
  if (result._tag === "Failure") {
    return result;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result;
}
