import type { EnvironmentId } from "@t3tools/contracts";
import { descriptionToSave, singleLineTitle, titleToSave } from "@t3tools/tasks-client/taskEdits";
import { useGT } from "gt-react-native";
import { useId, useRef, useState, type ReactNode } from "react";
import { InputAccessoryView, Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { PullRequestSectionHeading } from "../pull-requests/PullRequestSectionHeading";
import { TaskMarkdown } from "./TaskMarkdown";

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
      <Text selectable className="text-xl font-t3-bold leading-7">
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
      className="-mx-1 min-h-0 rounded-lg border-0 bg-transparent px-1 py-0.5 text-xl font-t3-bold leading-7 text-foreground"
    />
  );
}

/**
 * The task's description: its Markdown as today, and for someone who may edit it a plain text
 * editor behind Edit. Done or leaving the field saves, as the desktop saves on blur.
 */
export function TaskDescriptionField(props: {
  readonly value: string;
  readonly canEdit: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly onSave: (description: string) => Promise<boolean>;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState<{ readonly text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<{ blur: () => void } | null>(null);
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
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <PullRequestSectionHeading>{gt("Description")}</PullRequestSectionHeading>
        {props.canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? gt("Done") : gt("Edit description")}
            disabled={saving}
            hitSlop={8}
            onPress={() => (editing ? inputRef.current?.blur() : setEditing({ text: props.value }))}
          >
            <Text
              className={cn("text-base", saving ? "text-foreground-muted" : "text-primary-text")}
            >
              {editing
                ? gt("Done")
                : gt("Edit", { $context: "button that edits a task's description" })}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
          className="min-h-36 rounded-[20px] bg-grouped-card p-4 text-base text-foreground"
          style={{ textAlignVertical: "top" }}
        />
      ) : props.value.trim() ? (
        <TaskMarkdown markdown={props.value} environmentId={props.environmentId} cwd={props.cwd} />
      ) : (
        <Text className="text-sm text-foreground-muted">{gt("No description.")}</Text>
      )}
      {editing && Platform.OS === "ios" ? (
        // A long description scrolls Done above out of view; the keyboard's bar keeps it in reach.
        <InputAccessoryView nativeID={accessoryId}>
          <View className="flex-row justify-end border-t border-border bg-sheet px-4 py-2">
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              hitSlop={8}
              onPress={() => inputRef.current?.blur()}
            >
              <Text className="text-base font-t3-semibold text-primary-text">{gt("Done")}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

/** One row of the task's Details: its name, and the value or control at the end. */
export function TaskDetailRow(props: {
  readonly label: string;
  readonly first?: boolean;
  readonly children: ReactNode;
  /** Makes the whole row a button with a chevron, such as Tags opening its editor. */
  readonly onPress?: () => void;
  readonly accessibilityValue?: string;
}) {
  const content = (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-2">
      <Text className="shrink-0 text-base text-foreground">{props.label}</Text>
      <View className="min-w-0 flex-1 flex-row flex-wrap items-center justify-end gap-1.5">
        {props.children}
      </View>
      {props.onPress ? (
        <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
      ) : null}
    </View>
  );
  return (
    <View className={props.first ? undefined : "border-t border-border-subtle"}>
      {props.onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[props.label, props.accessibilityValue].filter(Boolean).join(", ")}
          onPress={props.onPress}
          className="active:bg-row-hover"
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
    </View>
  );
}
