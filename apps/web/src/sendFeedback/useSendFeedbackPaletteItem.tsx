import { useGT } from "gt-react";
import { MessageSquareTextIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "~/components/CommandPalette.logic";
import { productSurface } from "~/product/productFlags";
import { requestSendFeedback } from "./sendFeedbackStore";
import { useSendFeedbackAvailable } from "./useSendFeedback";

/** "Send feedback": opens the form in the notifications popover, when this client may send it. */
export function useSendFeedbackPaletteItem(): CommandPaletteActionItem | null {
  const gt = useGT();
  const available = useSendFeedbackAvailable();
  // The form lives in the notifications popover, which only our sidebar has.
  if (!available || productSurface("sidebarNotifications") !== "upcomputer") return null;
  return {
    kind: "action",
    value: "action:send-feedback",
    searchTerms: ["feedback", "bug", "idea", "report", "suggest", "contact", "problem"],
    title: gt("Send feedback"),
    description: gt("Report a bug or share an idea"),
    icon: <MessageSquareTextIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      requestSendFeedback();
    },
  };
}
