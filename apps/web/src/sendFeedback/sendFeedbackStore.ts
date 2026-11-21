const listeners = new Set<() => void>();

/** Opens the feedback form in the notifications popover, from anywhere in the app. */
export function requestSendFeedback(): void {
  for (const listener of listeners) listener();
}

/** Called on each request; the notifications button listens while it is mounted. */
export function onSendFeedbackRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
