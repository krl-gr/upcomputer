import { LazyMarkdownEditor } from "../../markdown/LazyMarkdownEditor.tsx";

/**
 * A task description: always editable markdown that reads like the rendered
 * text (wande's Milkdown editor). Agents write descriptions in markdown too.
 */
export function DescriptionField(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoFocus?: boolean;
  readonly className?: string;
}) {
  return (
    <LazyMarkdownEditor
      value={props.value}
      onChange={props.onChange}
      ariaLabel="Description"
      placeholder="Description, / for blocks"
      {...(props.autoFocus ? { autoFocus: true } : {})}
      className={props.className ?? "min-h-24 text-sm"}
    />
  );
}
