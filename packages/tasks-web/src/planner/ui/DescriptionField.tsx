import { useState } from "react";

import ChatMarkdown from "../../../../../apps/web/src/components/ChatMarkdown.tsx";
import { Textarea } from "../../../../../apps/web/src/components/ui/textarea.tsx";

/**
 * A task description: the rendered markdown, which turns into a textarea on
 * click and back on blur. Agents write descriptions in markdown too, so one
 * renderer serves both. (Wande used Milkdown; a rich editor can come later.)
 */
export function DescriptionField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly cwd: string | undefined;
  readonly rows: number;
  readonly autoEdit?: boolean;
}) {
  const [editing, setEditing] = useState(props.autoEdit === true || props.value.trim() === "");
  if (!editing)
    return (
      <div
        className="min-h-24 cursor-text rounded-lg border border-transparent px-3 py-2 hover:border-input"
        role="button"
        tabIndex={0}
        aria-label="Edit description"
        onClick={(event) => {
          if ((event.target as Element).closest("a, button, input")) return;
          setEditing(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            setEditing(true);
          }
        }}
      >
        <ChatMarkdown text={props.value} cwd={props.cwd} className="text-sm" lineBreaks />
      </div>
    );
  return (
    <Textarea
      value={props.value}
      rows={props.rows}
      placeholder="Description (markdown)"
      aria-label="Description"
      autoFocus={props.value.trim() !== ""}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      onBlur={() => {
        if (props.value.trim() !== "") setEditing(false);
      }}
    />
  );
}
