/** A window header's title: a growing textarea, as wande's DetailHeader. */
export function TitleInput(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly placeholder: string;
  readonly ariaLabel?: string;
}) {
  return (
    <textarea
      rows={1}
      className="field-sizing-content min-w-0 flex-1 resize-none overflow-hidden bg-transparent pt-1 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel ?? "Task title"}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      onBlur={props.onBlur}
    />
  );
}
