import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  type LucideIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  SquareCodeIcon,
  Table2Icon,
} from "lucide-react";
import { decodeMsg, msg } from "gt-react";

import type { SlashCommandId } from "./markdownEditorCore.ts";

const SLASH_COMMANDS: ReadonlyArray<{
  readonly id: SlashCommandId;
  readonly label: string;
  readonly keywords: string;
  readonly icon: LucideIcon;
}> = [
  {
    id: "text",
    label: msg("Text", { $context: "markdown block type: plain paragraph" }),
    keywords: "paragraph p",
    icon: PilcrowIcon,
  },
  { id: "h1", label: msg("Heading 1"), keywords: "title", icon: Heading1Icon },
  { id: "h2", label: msg("Heading 2"), keywords: "", icon: Heading2Icon },
  { id: "h3", label: msg("Heading 3"), keywords: "", icon: Heading3Icon },
  { id: "bullet", label: msg("Bullet list"), keywords: "ul", icon: ListIcon },
  { id: "ordered", label: msg("Numbered list"), keywords: "ordered ol", icon: ListOrderedIcon },
  { id: "task", label: msg("Checklist"), keywords: "task todo checkbox", icon: ListTodoIcon },
  {
    id: "quote",
    label: msg("Quote", { $context: "markdown block type" }),
    keywords: "blockquote",
    icon: QuoteIcon,
  },
  { id: "divider", label: msg("Divider"), keywords: "hr rule", icon: MinusIcon },
  {
    id: "table",
    label: msg("Table", { $context: "markdown block type" }),
    keywords: "grid",
    icon: Table2Icon,
  },
  { id: "code", label: msg("Code block"), keywords: "snippet", icon: SquareCodeIcon },
];

/**
 * The `/` menu's blocks for a query, with translated labels. A block matches
 * by its translated name, its English name or its keywords, so `/h2` and
 * `/heading` work in every UI language.
 */
export function slashCommandsFor(query: string, translate: (label: string) => string) {
  const needle = query.toLowerCase();
  return SLASH_COMMANDS.flatMap((command) => {
    const label = translate(command.label);
    const names = `${label} ${decodeMsg(command.label)} ${command.id} ${command.keywords}`;
    return names.toLowerCase().includes(needle) ? [{ ...command, label }] : [];
  });
}
