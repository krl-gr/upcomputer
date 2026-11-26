import { type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { tagSuggestions, tagsWithAdded } from "@t3tools/tasks-client/tags/tagSuggestions";
import { TaskId, type Task, type TaskAgent } from "@t3tools/tasks-contracts/v1";
import { useGT } from "gt-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { PullRequestSheetContent } from "../pull-requests/PullRequestSheetContent";
import { readTasksClient } from "./tasksRpc";

export type TaskTagsParams = {
  readonly environmentId: string;
  readonly taskId: string;
  readonly title: string;
};

interface TagSources {
  readonly task: Task;
  readonly agents: readonly TaskAgent[];
  readonly knownTags: readonly string[];
}

const SUGGESTION_LIMIT = 8;
const MISSING = Symbol("missing");

/**
 * A worker task's tags, as the desktop's tag field edits them: remove one, or add one typed or
 * picked from the suggestions (the trigger tags of the workers serving the task's project, with
 * their names, then tags other tasks use). Every change saves at once.
 */
export function TaskTagsScreen({ route }: StaticScreenProps<TaskTagsParams>) {
  const gt = useGT();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const taskId = TaskId.make(route.params.taskId);
  const [sources, setSources] = useState<TagSources | null>(null);
  const [loadError, setLoadError] = useState<string | typeof MISSING | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the task, its computer's workers and the tags its tasks use
  useEffect(() => {
    let cancelled = false;
    const client = readTasksClient(environmentId);
    Promise.all([
      client.tasks.get({ id: taskId }),
      client.agents.search({}).then(
        (result) => result.agents,
        () => [],
      ),
      client.tasks.page({ omitText: true, audience: "agent", limit: 200 }).then(
        (result) => result.tasks.flatMap((task) => task.tags),
        () => [],
      ),
    ]).then(
      ([task, agents, knownTags]) => {
        if (cancelled) return;
        if (task === null) setLoadError(MISSING);
        else setSources({ task, agents, knownTags });
      },
      (cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, taskId]);

  const save = async (tags: string[]) => {
    if (sources === null || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    await readTasksClient(environmentId)
      .tasks.update({ id: taskId, tags })
      .then(
        (task) => setSources((current) => (current === null ? current : { ...current, task })),
        (cause: unknown) =>
          Dialog.alert(
            gt("Couldn't save the task"),
            cause instanceof Error ? cause.message : String(cause),
          ),
      );
    inFlight.current = false;
    setSaving(false);
  };
  const add = (text: string) => {
    setQuery("");
    if (sources === null) return;
    const next = tagsWithAdded(sources.task.tags, text);
    if (next !== null) void save(next);
  };

  const tags = sources?.task.tags ?? [];
  const suggestions =
    sources === null
      ? []
      : tagSuggestions({
          query,
          taskTags: tags,
          projectId: sources.task.projectId,
          agents: sources.agents,
          knownTags: sources.knownTags,
        }).slice(0, SUGGESTION_LIMIT);

  return (
    <PullRequestSheetContent title={gt("Tags")} subtitle={route.params.title}>
      {sources === null ? (
        loadError === null ? (
          <AppActivityIndicator
            className="my-8"
            colorClassName="accent-icon"
            accessibilityLabel={gt("Loading task")}
          />
        ) : (
          <Text selectable className="text-sm text-danger-foreground">
            {loadError === MISSING ? gt("Task not found.") : loadError}
          </Text>
        )
      ) : (
        <>
          <View className="flex-row flex-wrap items-center gap-2">
            {tags.length === 0 ? (
              <Text className="text-sm text-foreground-muted">
                {gt("None", { $context: "a task has no tags" })}
              </Text>
            ) : (
              tags.map((tag) => (
                <View
                  key={tag}
                  className="flex-row items-center gap-1 rounded-full bg-subtle py-1 pl-3 pr-1"
                >
                  <Text className="text-sm text-foreground" numberOfLines={1}>
                    {tag}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={gt("Remove tag {tag}", { tag })}
                    disabled={saving}
                    hitSlop={8}
                    onPress={() => void save(tags.filter((other) => other !== tag))}
                    className="size-6 items-center justify-center rounded-full active:opacity-60"
                  >
                    <SymbolView name="xmark" size={11} tintColorClassName="accent-icon-muted" />
                  </Pressable>
                </View>
              ))
            )}
            {saving ? (
              <AppActivityIndicator size="small" colorClassName="accent-icon-muted" />
            ) : null}
          </View>
          <TextInput
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            accessibilityLabel={gt("Add a tag")}
            placeholder={gt("Tag…")}
            placeholderTextColorClassName="accent-foreground-muted"
            returnKeyType="done"
            submitBehavior="submit"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => add(query)}
            className="min-h-12 rounded-[20px] bg-grouped-card px-4 text-base text-foreground"
          />
          {suggestions.length > 0 ? (
            <View
              accessibilityLabel={gt("Tag suggestions")}
              className="overflow-hidden rounded-[20px] bg-grouped-card"
            >
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={suggestion.tag}
                  accessibilityRole="button"
                  accessibilityLabel={[suggestion.tag, ...suggestion.agents].join(", ")}
                  disabled={saving}
                  onPress={() => add(suggestion.tag)}
                  className={`min-h-11 flex-row items-center gap-3 px-4 active:bg-row-hover ${
                    index === 0 ? "" : "border-t border-border-subtle"
                  }`}
                >
                  <Text className="min-w-0 shrink text-base text-foreground" numberOfLines={1}>
                    {suggestion.tag}
                  </Text>
                  {suggestion.agents.length > 0 ? (
                    <Text
                      className="ml-auto min-w-0 shrink text-right text-sm text-foreground-muted"
                      numberOfLines={1}
                    >
                      {suggestion.agents.join(", ")}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}
    </PullRequestSheetContent>
  );
}
