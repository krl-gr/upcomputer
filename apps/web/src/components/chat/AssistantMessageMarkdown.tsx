import type { ComponentProps } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { MESSAGE_HEADING_LEVEL } from "./TimelineRowParts";

/**
 * An agent's reply. A chat message and a task's output both render through here, so whatever a
 * reply can show in chat, an output shows too.
 */
export function AssistantMessageMarkdown(
  props: Omit<ComponentProps<typeof ChatMarkdown>, "lineBreaks" | "headingLevelOffset">,
) {
  // A chat reply's single line breaks are lines (poems, addresses, label above a path).
  return <ChatMarkdown {...props} lineBreaks headingLevelOffset={MESSAGE_HEADING_LEVEL} />;
}
