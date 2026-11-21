import { create } from "zustand";

// A count, not a flag: the notifications button opens the form on each new request.
const useSendFeedbackStore = create(() => ({ requests: 0 }));

/** Opens the feedback form in the notifications popover, from anywhere in the app. */
export function requestSendFeedback(): void {
  useSendFeedbackStore.setState((state) => ({ requests: state.requests + 1 }));
}

export function useSendFeedbackRequests(): number {
  return useSendFeedbackStore((state) => state.requests);
}
