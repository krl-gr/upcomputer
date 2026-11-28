import type { EnvironmentId } from "@t3tools/contracts";
import { descriptionToSave, singleLineTitle, titleToSave } from "@t3tools/tasks-client/taskEdits";
import { useGT } from "gt-react-native";
import { Children, Fragment, isValidElement, useId, useRef, useState, type ReactNode } from "react";
import { InputAccessoryView, Platform, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { UpIcon } from "../../components/up-icons/UpIcon";
import { cn } from "../../lib/cn";
import { TaskMarkdown } from "./TaskMarkdown";

/**
 * The desktop's collapsible detail section in the Tasks list's group header type: the name, a
 * chevron, and the count or an action at the end.
 */
export function TaskPageSection(props: {
  readonly title: string;
  readonly count?: number;
  readonly defaultOpen?: boolean;
  /** Keeps the section open, such as while its content is being edited. */
  readonly forceOpen?: boolean;
  /** A control at the end of the header, in place of the count. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const [chosenOpen, setOpen] = useState(props.defaultOpen ?? true);
  const open = chosenOpen || props.forceOpen === true;
  return (
    <View>
      <View className="min-h-11 flex-row items-center gap-2 px-1">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={
            props.count === undefined ? props.title : `${props.title}, ${props.count}`
          }
          accessibilityHint={open ? gt("Hides the section") : gt("Shows the section")}
          disabled={props.forceOpen === true}
          onPress={() => setOpen(!open)}
          className="min-h-11 min-w-0 flex-1 flex-row items-center gap-2 active:opacity-60"
        >
          <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
            <Text
              className="shrink text-base font-t3-medium text-foreground-tertiary"
              numberOfLines={1}
            >
              {props.title}
            </Text>
            <UpIcon
              name={open ? "chevron-down" : "chevron-right"}
              size={17}
              tintColorClassName="accent-icon-muted"
            />
          </View>
          {props.action !== undefined || props.count === undefined ? null : (
            <Text className="text-base tabular-nums text-foreground-tertiary">{props.count}</Text>
          )}
        </Pressable>
        {props.action}
      </View>
      {open ? <View className="pb-3 pt-1">{props.children}</View> : null}
    </View>
  );
}

/** An iOS inset grouped card whose rows are split by hairlines. */
export function GroupedCard(props: { readonly children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-[14px] border-continuous bg-grouped-card">
      {Children.toArray(props.children).map((row, index) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
          {index > 0 ? (
            <View className="ml-4 bg-separator" style={{ height: StyleSheet.hairlineWidth }} />
          ) : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** One Details row: its name, and the value or control at the end. */
export function DetailRow(props: {
  readonly label: string;
  readonly children: ReactNode;
  /** Makes the whole row a button, such as Tags opening its editor. */
  readonly onPress?: () => void;
  readonly accessibilityValue?: string;
  /** Ends a button row with a chevron. */
  readonly chevron?: boolean;
}) {
  const content = (
    <View className="min-h-11 flex-row items-center gap-3 px-4 py-2.5">
      <Text className="shrink-0 text-base text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">
        {props.children}
        {props.chevron ? (
          <UpIcon name="chevron-right" size={15} tintColorClassName="accent-icon-muted" />
        ) : null}
      </View>
    </View>
  );
  if (!props.onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.accessibilityValue === undefined
          ? undefined
          : [props.label, props.accessibilityValue].join(", ")
      }
      onPress={props.onPress}
      className="active:bg-foreground/5"
    >
      {content}
    </Pressable>
  );
}

export function DetailValue(props: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <Text
      numberOfLines={1}
      className={cn("shrink text-right text-base text-foreground-secondary", props.className)}
    >
      {props.children}
    </Text>
  );
}

const TITLE_CLASS = "text-[22px] font-t3-bold leading-7 text-foreground";

type TitleDraft =
  | { readonly kind: "editing"; readonly text: string }
  | { readonly kind: "saving"; readonly base: string; readonly text: string };

/**
 * The task title at the top of its page, edited in place as on the desktop: the draft holds while
 * the field has focus, so a remote change can't replace what is being typed, and saves when it
 * loses focus or Return is pressed. A failed save puts the saved title back.
 */
export function TaskTitleField(props: {
  readonly value: string;
  readonly canEdit: boolean;
  readonly onSave: (title: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState<TitleDraft | null>(null);
  const shown =
    draft === null
      ? props.value
      : draft.kind === "editing" || draft.base === props.value
        ? draft.text
        : props.value;
  if (!props.canEdit) {
    return (
      <Text selectable className={TITLE_CLASS}>
        {props.value}
      </Text>
    );
  }
  const commit = () => {
    if (draft?.kind !== "editing") return;
    const title = titleToSave(draft.text, props.value);
    if (title === null) {
      setDraft(null);
      return;
    }
    const base = props.value;
    setDraft({ kind: "saving", base, text: title });
    void props.onSave(title).then((saved) => {
      if (saved) return;
      setDraft((current) =>
        current?.kind === "saving" && current.base === base && current.text === title
          ? null
          : current,
      );
    });
  };
  return (
    <TextInput
      multiline
      scrollEnabled={false}
      value={shown}
      accessibilityLabel={gt("Task title")}
      placeholder={gt("Task title…")}
      placeholderTextColorClassName="accent-foreground-muted"
      maxLength={1024}
      returnKeyType="done"
      submitBehavior="blurAndSubmit"
      onFocus={() => setDraft({ kind: "editing", text: shown })}
      onChangeText={(text) => setDraft({ kind: "editing", text: singleLineTitle(text) })}
      onBlur={commit}
      className={cn("-mx-1 min-h-0 rounded-lg border-0 bg-transparent px-1 py-0", TITLE_CLASS)}
    />
  );
}

/**
 * The task's Description section: its Markdown, and for someone who may edit it a plain text
 * editor behind Edit. Done or leaving the field saves, as the desktop saves on blur.
 */
export function TaskDescriptionField(props: {
  readonly value: string;
  readonly canEdit: boolean;
  readonly defaultOpen: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly onSave: (description: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState<{ readonly text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<{ blur: () => void; isFocused: () => boolean } | null>(null);
  const accessoryId = useId();
  const finish = async () => {
    if (editing === null || saving) return;
    const description = descriptionToSave(editing.text, props.value);
    if (description === null) {
      setEditing(null);
      return;
    }
    setSaving(true);
    const saved = await props.onSave(description);
    setSaving(false);
    if (saved) setEditing(null);
  };
  // Leaving the field saves; after a failed save it is no longer focused, so Done saves itself.
  const done = () => (inputRef.current?.isFocused() ? inputRef.current.blur() : void finish());
  return (
    <>
      <TaskPageSection
        title={gt("Description")}
        defaultOpen={props.defaultOpen}
        forceOpen={editing !== null}
        action={
          props.canEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? gt("Done") : gt("Edit description")}
              disabled={saving}
              hitSlop={8}
              onPress={() => (editing ? done() : setEditing({ text: props.value }))}
              className="min-h-11 justify-center active:opacity-60"
            >
              <Text
                className={cn("text-base", saving ? "text-foreground-muted" : "text-primary-text")}
              >
                {editing
                  ? gt("Done")
                  : gt("Edit", { $context: "button that edits a task's description" })}
              </Text>
            </Pressable>
          ) : undefined
        }
      >
        {editing ? (
          <TextInput
            ref={(input) => {
              inputRef.current = input;
            }}
            autoFocus
            multiline
            editable={!saving}
            accessibilityLabel={gt("Task description")}
            placeholder={gt("Description…")}
            placeholderTextColorClassName="accent-foreground-muted"
            maxLength={65536}
            value={editing.text}
            onChangeText={(text) => setEditing({ text })}
            onBlur={() => void finish()}
            inputAccessoryViewID={Platform.OS === "ios" ? accessoryId : undefined}
            className="min-h-36 rounded-[14px] border-continuous bg-grouped-card p-4 text-base text-foreground"
            style={{ textAlignVertical: "top" }}
          />
        ) : props.value.trim() ? (
          <View className="px-1">
            <TaskMarkdown
              markdown={props.value}
              environmentId={props.environmentId}
              cwd={props.cwd}
            />
          </View>
        ) : (
          <Text className="px-1 text-base text-foreground-muted">
            {gt("No description", { $context: "a task has no description" })}
          </Text>
        )}
      </TaskPageSection>
      {editing && Platform.OS === "ios" ? (
        // A long description scrolls Done above out of view; the keyboard's bar keeps it in reach.
        // Outside the section: it links to its input only when that input is already on screen.
        <InputAccessoryView nativeID={accessoryId}>
          <View className="flex-row justify-end border-t border-border bg-sheet px-4 py-2">
            <Pressable accessibilityRole="button" disabled={saving} hitSlop={8} onPress={done}>
              <Text className="text-base font-t3-semibold text-primary-text">{gt("Done")}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </>
  );
}
