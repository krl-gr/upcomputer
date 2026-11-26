import { LegendList } from "@legendapp/list/react-native";
import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectIconColor, ProjectId } from "@t3tools/contracts";
import {
  addDays,
  DAY_COUNT_OPTIONS,
  dateOfKey,
  localeWeekStart,
  todayKey,
  viewStartFor,
  type DateKey,
} from "@t3tools/tasks-client/planner/dates";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import type { PlannerStore } from "@t3tools/tasks-client/planner/plannerStore";
import { progressLabel, weekRangeOf } from "@t3tools/tasks-client/planner/progress";
import {
  PERSON_DONE_STATUS,
  PERSON_OPEN_STATUS,
  type TaskId,
  type TaskScheduleEntry,
  type TaskScheduleEntryId,
  type TaskScheduleEntryStatus,
} from "@t3tools/tasks-contracts/v1";
import { useGT, useLocale } from "gt-react-native";
import { memo, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Menu } from "../../../components/ui/Menu";
import { Toolbar } from "../../../components/ui/Toolbar";
import { useContentTopInset } from "../../../components/ui/useBarInset";
import { cn } from "../../../lib/cn";
import { projectIconColorClassNames } from "../../../lib/projectIcon";
import { NativeScrollView } from "../../../native/NativeScrollViewMarker";
import { useNativeColumnLayoutMetrics } from "../../../native/native-layout-metrics";
import { useProjects } from "../../../state/entities";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import { RowControl } from "../RowControl";
import { TaskProjectBadge } from "../TaskProjectBadge";
import { TasksToolbar } from "../TasksHeader";
import { updateTasksPreferences, useTasksPreferences } from "../tasksPreferences";
import { useTasksAccess } from "../tasksRpc";
import { plannerStoreFor, usePlanner, usePlannerAvailability } from "./plannerData";
import {
  dayEntries,
  isFinishedTask,
  plannerDays,
  plannerGate,
  plannerKindOf,
  plannerProjectColor,
  steppedWeekStart,
  toggledEntryStatus,
  type WeekStep,
} from "./plannerState";

/** A card's stripe in its project's badge color; classes stay literal for the style compiler. */
const STRIPE_CLASSES: Record<ProjectIconColor, string> = {
  gray: "bg-gray-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
  lime: "bg-lime-500",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  purple: "bg-purple-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
};

const DEFAULT_WEEK_HEIGHT = 300;
const MIN_WEEK_HEIGHT = 140;

/**
 * My tasks and My routines: the desktop planner at narrow width, the week on top, the handle,
 * then the list. One computer at a time, as the desktop's planner.
 */
export function PlannerView(props: {
  readonly view: "mine" | "routines";
  readonly environmentId: EnvironmentId | null;
  readonly connected: boolean;
  readonly sidebar: boolean;
  readonly environmentMenu: ReactNode;
}) {
  const gt = useGT();
  const locale = useLocale();
  const navigation = useNavigation();
  const kind = plannerKindOf(props.view);
  const routines = kind === "routine";
  const access = useTasksAccess(props.connected ? props.environmentId : null);
  const planner = usePlannerAvailability(
    props.connected && access?.availability === "enabled" ? props.environmentId : null,
  );
  const gate = plannerGate({
    hasEnvironment: props.environmentId !== null,
    connected: props.connected,
    access: access?.availability ?? null,
    planner,
  });
  const canEdit = gate === "ready" && access?.canMutateTasks === true;
  const preferences = useTasksPreferences();
  const [showArchive, setShowArchive] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const listOptions = (
    <Toolbar.Menu inline title={gt("List options")}>
      <Toolbar.MenuAction
        icon="checkmark.circle"
        disabled={gate !== "ready"}
        isOn={selectMode}
        onPress={() => setSelectMode(!selectMode)}
      >
        {gt("Select", { $context: "menu item that turns on select mode" })}
      </Toolbar.MenuAction>
      <Toolbar.MenuAction
        icon="archivebox"
        isOn={showArchive}
        onPress={() => setShowArchive(!showArchive)}
      >
        {gt("Show archive")}
      </Toolbar.MenuAction>
      <Toolbar.MenuAction
        icon="rectangle.topthird.inset.filled"
        onPress={() => updateTasksPreferences({ weekHidden: !preferences.weekHidden })}
      >
        {preferences.weekHidden ? gt("Show the week") : gt("Hide the week")}
      </Toolbar.MenuAction>
      {props.environmentMenu}
    </Toolbar.Menu>
  );
  const toolbar = (
    <TasksToolbar
      createLabel={routines ? gt("New routine") : gt("New task")}
      createDisabled={!canEdit}
      onCreate={() =>
        props.environmentId !== null &&
        navigation.navigate("TaskCreate", {
          environmentId: String(props.environmentId),
          plannerKind: kind,
        })
      }
      menuLabel={gt("List options")}
      applied={showArchive}
      sections={listOptions}
    />
  );
  if (gate !== "ready" || props.environmentId === null)
    return (
      <View className={props.sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
        {toolbar}
        <GateNotice gate={gate} routines={routines} />
      </View>
    );
  return (
    <PlannerBody
      key={`${props.environmentId}:${kind}`}
      environmentId={props.environmentId}
      routines={routines}
      canEdit={canEdit}
      sidebar={props.sidebar}
      toolbar={toolbar}
      locale={locale}
      showArchive={showArchive}
      selectMode={selectMode}
      onSelectModeChange={setSelectMode}
    />
  );
}

function PlannerBody(props: {
  readonly environmentId: EnvironmentId;
  readonly routines: boolean;
  readonly canEdit: boolean;
  readonly sidebar: boolean;
  readonly toolbar: ReactNode;
  readonly locale: string;
  readonly showArchive: boolean;
  readonly selectMode: boolean;
  readonly onSelectModeChange: (selectMode: boolean) => void;
}) {
  const gt = useGT();
  const selectDetail = useSelectWorkspaceDetail();
  // Absent in the chat's side panel, which shows these views outside the workspace tabs.
  const workspace = useWorkspaceTabs();
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const columnSafeBottom = useNativeColumnLayoutMetrics()?.safeArea.bottom;
  const bottomSafeArea =
    Platform.OS === "ios" ? (columnSafeBottom ?? insets.bottom) : insets.bottom;
  const { height: windowHeight } = useWindowDimensions();
  const preferences = useTasksPreferences();
  const kind = props.routines ? "routine" : "task";
  const store = plannerStoreFor(props.environmentId);
  const weekStartDay = useMemo(() => localeWeekStart(props.locale), [props.locale]);
  const today = todayKey();
  const dayCount = preferences.daysShown;
  const [start, setStart] = useState<DateKey>(() => viewStartFor(today, dayCount, weekStartDay));
  const [markedDate, setMarkedDate] = useState<DateKey>(today);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const days = plannerDays(start, dayCount);
  const snapshot = usePlanner({
    store,
    kind,
    archiveVisible: props.showArchive,
    weekFrom: days[0]!,
    weekTo: days.at(-1)!,
    progressWindow: props.routines ? weekRangeOf(today, weekStartDay) : null,
  });
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const projectById = new Map<string, EnvironmentProject>(
    projects.map((project) => [project.id, project]),
  );
  const list = props.showArchive ? snapshot.archive : snapshot.active;
  const tasks = list.ids.flatMap((id) => {
    const task = snapshot.view.tasks.get(id);
    return task ? [task] : [];
  });
  const openTask = (taskId: string, title: string) => {
    Keyboard.dismiss();
    selectDetail({
      name: "Task",
      params: { environmentId: String(props.environmentId), taskId, title },
    });
  };
  const step = (to: WeekStep) =>
    setStart(steppedWeekStart({ start, step: to, today, dayCount, weekStartDay }));
  const dayName = (date: DateKey) =>
    dateOfKey(date).toLocaleDateString(props.locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  const selectedTasks = tasks.filter((task) => selected.has(task.id));
  const exitSelect = () => {
    setSelected(new Set());
    props.onSelectModeChange(false);
  };

  // The handle resizes the week; the height is remembered when the drag ends.
  const maxWeekHeight = Math.max(MIN_WEEK_HEIGHT, windowHeight * 0.6);
  const weekHeight = Math.min(
    maxWeekHeight,
    Math.max(MIN_WEEK_HEIGHT, preferences.weekHeight ?? DEFAULT_WEEK_HEIGHT),
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const clampHeight = (height: number) =>
    Math.min(maxWeekHeight, Math.max(MIN_WEEK_HEIGHT, height));
  // The week's height holds still during a drag, so one responder serves the whole gesture.
  const handle = useMemo(() => {
    const clamp = (height: number) => Math.min(maxWeekHeight, Math.max(MIN_WEEK_HEIGHT, height));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_event, gesture) => setDragHeight(clamp(weekHeight + gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        setDragHeight(null);
        updateTasksPreferences({ weekHeight: clamp(weekHeight + gesture.dy) });
      },
      onPanResponderTerminate: () => setDragHeight(null),
    });
  }, [weekHeight, maxWeekHeight]);

  const listEmpty =
    list.status === "LoadingFirstPage" ? (
      <View className="items-center py-8">
        <AppActivityIndicator
          colorClassName="accent-icon"
          accessibilityLabel={props.routines ? gt("Loading routines") : gt("Loading tasks")}
        />
      </View>
    ) : (
      <View className="px-8 py-10">
        <EmptyState
          variant="plain"
          title={
            list.error
              ? gt("Couldn't load tasks")
              : props.showArchive
                ? props.routines
                  ? gt("No done or archived routines")
                  : gt("No done or archived tasks")
                : props.routines
                  ? gt("No routines yet")
                  : gt("No tasks yet")
          }
          detail={
            list.error ??
            (props.showArchive
              ? ""
              : props.routines
                ? gt("Tap + to add a habit or chore that repeats on a schedule.")
                : gt("Tap + to add one, or ask any thread to plan the work for you."))
          }
        />
      </View>
    );

  return (
    <View
      className={props.sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}
      style={{ paddingTop: contentTopInset }}
    >
      {props.toolbar}
      {preferences.weekHidden ? null : (
        <>
          <WeekHeader
            start={start}
            days={days}
            locale={props.locale}
            dayCount={dayCount}
            onStep={step}
            onDayCount={(count) => {
              updateTasksPreferences({ daysShown: count });
              setStart(viewStartFor(start, count, weekStartDay));
            }}
          />
          <View
            style={{ height: dragHeight ?? weekHeight }}
            className="flex-row border-y border-border-subtle"
          >
            {days.map((date, index) => (
              <DayColumn
                key={date}
                date={date}
                first={index === 0}
                today={date === today}
                marked={date === markedDate}
                locale={props.locale}
                entries={dayEntries(snapshot.view.days.get(date), snapshot.view.tasks)}
                projectById={projectById}
                canEdit={props.canEdit}
                onMark={() => setMarkedDate(date)}
                onRescheduleIncomplete={() => void store.moveOpen(date, addDays(today, 1))}
                onOpen={(entry, title) => openTask(entry.taskId, title)}
                onToggle={(entry) =>
                  void store.updateEntry({
                    id: entry.id as TaskScheduleEntryId,
                    status: toggledEntryStatus(entry.status),
                  })
                }
                onStatus={(entry, status) =>
                  void store.updateEntry({ id: entry.id as TaskScheduleEntryId, status })
                }
                onMoveNext={(entry) =>
                  void store.moveEntries({
                    ids: [entry.id as TaskScheduleEntryId],
                    date: addDays(entry.date, 1),
                    placement: { at: "bottom" },
                  })
                }
                onCopyNext={(entry) =>
                  void store.copyEntries({
                    ids: [entry.id as TaskScheduleEntryId],
                    dates: [addDays(entry.date, 1)],
                    placement: { at: "bottom" },
                  })
                }
                onDelete={(entry) => void store.deleteEntries([entry.id])}
              />
            ))}
          </View>
          <View
            {...handle.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={gt("Week height")}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) =>
              updateTasksPreferences({
                weekHeight: clampHeight(
                  weekHeight + (event.nativeEvent.actionName === "increment" ? 60 : -60),
                ),
              })
            }
            className="-mt-2.5 h-5 items-center justify-center"
          >
            <View className="h-1.5 w-10 rounded-full bg-foreground-muted opacity-40" />
          </View>
        </>
      )}
      {snapshot.rangeError ? (
        <Text selectable className="px-4 pb-1 text-sm text-foreground-muted">
          {gt("The planner didn't load: {error}", { error: snapshot.rangeError })}
        </Text>
      ) : null}
      {props.selectMode ? (
        <BulkBar
          selected={selectedTasks}
          routines={props.routines}
          queueDate={props.showArchive ? null : markedDate}
          queueDateLabel={dayName(markedDate)}
          onExit={exitSelect}
          onRun={(action) => {
            exitSelect();
            void action(
              store,
              selectedTasks.map((task) => task.id),
            );
          }}
        />
      ) : null}
      <LegendList
        data={tasks}
        extraData={[selected, props.selectMode, snapshot.progress, markedDate]}
        keyExtractor={(task) => task.id}
        estimatedItemSize={92}
        drawDistance={800}
        recycleItems
        showsVerticalScrollIndicator={Platform.OS !== "android"}
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 4,
          paddingBottom: Math.max(bottomSafeArea, workspace?.bottomClearance ?? 0),
        }}
        onEndReached={() => {
          if (list.status === "CanLoadMore")
            store.loadMore(props.showArchive ? "archive" : "active");
        }}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <PlannerTaskRow
            task={item}
            routines={props.routines}
            canEdit={props.canEdit}
            environmentId={props.environmentId}
            projects={projects}
            project={projectById.get(item.projectId) ?? null}
            progress={progressLabel(snapshot.progress.get(item.id))}
            queueDate={props.showArchive ? null : markedDate}
            queueDateLabel={dayName(markedDate)}
            moveTargets={snapshot.active.ids.flatMap((id) => {
              const task = snapshot.view.tasks.get(id);
              return task && task.id !== item.id ? [task] : [];
            })}
            selectMode={props.selectMode}
            selected={selected.has(item.id)}
            onToggleSelected={() => {
              const next = new Set(selected);
              if (!next.delete(item.id)) next.add(item.id);
              setSelected(next);
            }}
            store={store}
            onOpen={() => openTask(item.id, item.title)}
          />
        )}
        ListFooterComponent={
          list.status === "LoadingMore" ? (
            <View className="items-center py-4">
              <AppActivityIndicator
                colorClassName="accent-icon"
                accessibilityLabel={gt("Loading…")}
              />
            </View>
          ) : list.status === "CanLoadMore" ? (
            <View className="items-center py-4">
              <Button
                label={gt("Load more")}
                onPress={() => store.loadMore(props.showArchive ? "archive" : "active")}
              />
            </View>
          ) : undefined
        }
        ListEmptyComponent={listEmpty}
      />
    </View>
  );
}

/** The desktop's week header: the month, back and forward a week or a day, Today, and its menu. */
function WeekHeader(props: {
  readonly start: DateKey;
  readonly days: readonly DateKey[];
  readonly locale: string;
  readonly dayCount: number;
  readonly onStep: (step: WeekStep) => void;
  readonly onDayCount: (count: (typeof DAY_COUNT_OPTIONS)[number]) => void;
}) {
  const gt = useGT();
  const first = dateOfKey(props.days[0] ?? props.start);
  const month = first.toLocaleDateString(props.locale, { month: "long" });
  const year = first.getFullYear();
  return (
    <View className="flex-row items-center gap-1.5 px-4 pb-2 pt-1">
      <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
        <Text className="font-t3-bold">{month}</Text>
        <Text className="text-foreground-muted"> {year}</Text>
      </Text>
      <RowControl
        icon={{ ios: "chevron.left.2", android: "check" }}
        accessibilityLabel={gt("Previous week")}
        onPress={() => props.onStep("previous-week")}
      />
      <RowControl
        icon="chevron.left"
        accessibilityLabel={gt("Previous day")}
        onPress={() => props.onStep("previous-day")}
      />
      <RowControl
        label={gt("Today")}
        accessibilityLabel={gt("Today")}
        onPress={() => props.onStep("today")}
      />
      <RowControl
        icon="chevron.right"
        accessibilityLabel={gt("Next day")}
        onPress={() => props.onStep("next-day")}
      />
      <RowControl
        icon={{ ios: "chevron.right.2", android: "check" }}
        accessibilityLabel={gt("Next week")}
        onPress={() => props.onStep("next-week")}
      />
      <Menu
        title={gt("View options")}
        actions={[
          {
            id: "days",
            title: gt("Days shown"),
            displayInline: true,
            subactions: DAY_COUNT_OPTIONS.map((count) => ({
              id: `days:${count}`,
              title: String(count),
              state: count === props.dayCount ? ("on" as const) : ("off" as const),
            })),
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          const count = DAY_COUNT_OPTIONS.find((option) => `days:${option}` === nativeEvent.event);
          if (count !== undefined) props.onDayCount(count);
        }}
      >
        <RowControl icon="ellipsis" accessibilityLabel={gt("View options")} />
      </Menu>
    </View>
  );
}

/**
 * A day column: the weekday and date (today in a blue badge), the day's menu, and its entry
 * cards in queue order. Tapping the header marks the day "Add to queue" adds to.
 */
const DayColumn = memo(function DayColumn(props: {
  readonly date: DateKey;
  readonly first: boolean;
  readonly today: boolean;
  readonly marked: boolean;
  readonly locale: string;
  readonly entries: ReturnType<typeof dayEntries>;
  readonly projectById: ReadonlyMap<string, EnvironmentProject>;
  readonly canEdit: boolean;
  readonly onMark: () => void;
  readonly onRescheduleIncomplete: () => void;
  readonly onOpen: (entry: TaskScheduleEntry, title: string) => void;
  readonly onToggle: (entry: TaskScheduleEntry) => void;
  readonly onStatus: (entry: TaskScheduleEntry, status: TaskScheduleEntryStatus) => void;
  readonly onMoveNext: (entry: TaskScheduleEntry) => void;
  readonly onCopyNext: (entry: TaskScheduleEntry) => void;
  readonly onDelete: (entry: TaskScheduleEntry) => void;
}) {
  const gt = useGT();
  const day = dateOfKey(props.date);
  const weekday = day.toLocaleDateString(props.locale, { weekday: "short" });
  const hasOpen = props.entries.some(({ entry }) => entry.status === "open");
  return (
    <View className={cn("min-w-0 flex-1", !props.first && "border-l border-border-subtle")}>
      <View className={cn("flex-row items-center gap-1 px-2 py-1.5", props.marked && "bg-subtle")}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: props.marked }}
          accessibilityLabel={day.toLocaleDateString(props.locale, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          accessibilityHint={gt("Marks the day that Add to queue adds to")}
          onPress={props.onMark}
          className="min-w-0 flex-1 flex-row items-center justify-center gap-1.5"
        >
          <Text className="text-sm font-t3-bold text-foreground">{weekday}</Text>
          <View
            className={cn(
              "min-w-6 items-center rounded-full px-1.5 py-px",
              props.today && "bg-adaptive-sky-600-400",
            )}
          >
            <Text
              className={cn(
                "text-sm tabular-nums",
                props.today ? "font-t3-bold text-screen" : "text-foreground-muted",
              )}
            >
              {day.getDate()}
            </Text>
          </View>
        </Pressable>
        {props.canEdit ? (
          <Menu
            title={gt("Day options")}
            actions={[
              {
                id: "reschedule",
                title: gt("Reschedule incomplete"),
                image: "arrow.uturn.forward",
                attributes: hasOpen ? undefined : { disabled: true },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "reschedule") props.onRescheduleIncomplete();
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={gt("Day options")}
              hitSlop={8}
              className="h-6 w-6 items-center justify-center"
            >
              <SymbolView name="ellipsis" size={14} tintColorClassName="accent-icon-muted" />
            </Pressable>
          </Menu>
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 6, gap: 6 }}
        showsVerticalScrollIndicator={false}
      >
        {props.entries.map(({ entry, task }) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            task={task}
            project={task ? (props.projectById.get(task.projectId) ?? null) : null}
            canEdit={props.canEdit}
            locale={props.locale}
            onOpen={() => props.onOpen(entry, task?.title ?? gt("Task"))}
            onToggle={() => props.onToggle(entry)}
            onStatus={(status) => props.onStatus(entry, status)}
            onMoveNext={() => props.onMoveNext(entry)}
            onCopyNext={() => props.onCopyNext(entry)}
            onDelete={() => props.onDelete(entry)}
          />
        ))}
      </ScrollView>
    </View>
  );
});

function entryTiming(entry: TaskScheduleEntry, locale: string, gt: ReturnType<typeof useGT>) {
  const time = entry.startTime
    ? (() => {
        const [hours, minutes] = entry.startTime.split(":").map(Number);
        return hours === undefined || minutes === undefined || Number.isNaN(hours + minutes)
          ? entry.startTime
          : new Date(2024, 0, 1, hours, minutes).toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
            });
      })()
    : null;
  const duration =
    entry.durationMinutes !== null
      ? gt("{minutes}m", {
          minutes: entry.durationMinutes,
          $context: "a duration in minutes, abbreviated",
        })
      : null;
  return [time, duration].filter((part) => part !== null).join(" · ");
}

/**
 * The desktop's entry card: a stripe and tint in the project's color, the title, time and
 * duration, the check-off and the entry's menu. A handled entry turns gray.
 */
const EntryCard = memo(function EntryCard(props: {
  readonly entry: TaskScheduleEntry;
  readonly task: PlannerTask | undefined;
  readonly project: EnvironmentProject | null;
  readonly canEdit: boolean;
  readonly locale: string;
  readonly onOpen: () => void;
  readonly onToggle: () => void;
  readonly onStatus: (status: TaskScheduleEntryStatus) => void;
  readonly onMoveNext: () => void;
  readonly onCopyNext: () => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const { entry, task } = props;
  const finished = task ? isFinishedTask(task) : false;
  const muted = entry.status !== "open" || finished;
  const color = muted || props.project?.isScratch ? null : plannerProjectColor(props.project);
  // An entry just added has no server id until the add returns, so nothing can change it yet.
  const editable = props.canEdit && !entry.id.startsWith("pending-entry-");
  const timing = entryTiming(entry, props.locale, gt);
  const title = task?.title ?? gt("Loading…");
  const statusItems = [
    { id: "status:open", title: gt("Not done"), image: "circle", status: "open" as const },
    {
      id: "status:done",
      title: gt("Done", { $context: "status of a planned day entry" }),
      image: "checkmark.circle",
      status: "done" as const,
    },
    {
      id: "status:skipped",
      title: gt("Skipped"),
      image: "slash.circle",
      status: "skipped" as const,
    },
  ];
  const more = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("More options")}
      disabled={!editable}
      hitSlop={8}
      className={cn("h-6 w-6 items-center justify-center", !editable && "opacity-40")}
    >
      <SymbolView name="ellipsis" size={14} tintColorClassName="accent-icon-muted" />
    </Pressable>
  );
  return (
    <View
      className={cn(
        "flex-row overflow-hidden rounded-lg",
        color ? projectIconColorClassNames(color).background : "bg-subtle",
      )}
    >
      <View
        className={cn(
          "my-1 ml-1 w-1 rounded-full",
          color ? STRIPE_CLASSES[color] : "bg-subtle-strong",
        )}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, timing].filter(Boolean).join(", ")}
        onPress={props.onOpen}
        className="min-w-0 flex-1 gap-0.5 py-1.5 pl-2 active:opacity-70"
      >
        <Text
          numberOfLines={3}
          className={cn(
            "text-sm font-t3-medium leading-tight",
            muted ? "text-foreground-muted" : "text-foreground",
            finished && "line-through",
          )}
        >
          {title}
        </Text>
        {timing ? (
          <Text className="text-xs tabular-nums text-foreground-muted">{timing}</Text>
        ) : null}
      </Pressable>
      <View className="items-center justify-between py-1 pr-1">
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={entry.status === "done" ? gt("Mark as not done") : gt("Mark as done")}
          accessibilityState={{ checked: entry.status === "done", disabled: !editable }}
          disabled={!editable}
          onPress={props.onToggle}
          hitSlop={8}
          className="h-6 w-6 items-center justify-center"
        >
          <SymbolView
            name={entry.status === "done" ? "checkmark.circle" : "circle"}
            size={17}
            tintColorClassName="accent-icon-muted"
          />
        </Pressable>
        {editable ? (
          <Menu
            title={title}
            actions={[
              ...statusItems.map((item) => ({
                id: item.id,
                title: item.title,
                image: item.image,
                state: entry.status === item.status ? ("on" as const) : ("off" as const),
              })),
              { id: "next", title: gt("Move to next day"), image: "arrow.right" },
              { id: "copy", title: gt("Copy to next day"), image: "doc.on.doc" },
              {
                id: "delete",
                title: gt("Delete"),
                image: "trash",
                attributes: { destructive: true },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              const id = nativeEvent.event;
              const status = statusItems.find((item) => item.id === id)?.status;
              if (status) props.onStatus(status);
              else if (id === "next") props.onMoveNext();
              else if (id === "copy") props.onCopyNext();
              else if (id === "delete") props.onDelete();
            }}
          >
            {more}
          </Menu>
        ) : (
          more
        )}
      </View>
    </View>
  );
});

type BulkAction = (store: PlannerStore, ids: readonly string[]) => Promise<unknown>;

/** Select mode's bar, as the desktop's list header holds it: the count and the bulk actions. */
function BulkBar(props: {
  readonly selected: readonly PlannerTask[];
  readonly routines: boolean;
  readonly queueDate: DateKey | null;
  readonly queueDateLabel: string;
  readonly onExit: () => void;
  readonly onRun: (action: BulkAction) => void;
}) {
  const gt = useGT();
  const none = props.selected.length === 0;
  const finished = props.selected.filter(isFinishedTask).length;
  const state =
    finished === 0 ? "active" : finished === props.selected.length ? "finished" : "mixed";
  return (
    <View className="flex-row flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2">
      <Text className="mr-1 text-base font-t3-bold tabular-nums text-foreground">
        {props.selected.length}
      </Text>
      {state !== "active" ? (
        <RowControl
          icon="arrow.uturn.backward"
          accessibilityLabel={gt("Restore", {
            $context: "button that unarchives the selected tasks",
          })}
          disabled={none}
          onPress={() => props.onRun((store, ids) => store.restore(ids))}
        />
      ) : null}
      {state !== "finished" ? (
        <>
          <RowControl
            icon="checkmark.circle"
            accessibilityLabel={gt("Mark as done")}
            disabled={none}
            onPress={() => props.onRun((store, ids) => store.markDone(ids))}
          />
          <RowControl
            icon="archivebox"
            accessibilityLabel={gt("Archive", {
              $context: "button that archives the selected tasks",
            })}
            disabled={none}
            onPress={() => props.onRun((store, ids) => store.archive(ids))}
          />
        </>
      ) : null}
      {props.queueDate !== null ? (
        <RowControl
          icon={{ ios: "text.badge.plus", android: "check" }}
          accessibilityLabel={gt("Add to queue for {date}", { date: props.queueDateLabel })}
          disabled={none}
          onPress={() =>
            props.onRun((store, ids) =>
              store.addEntries({ taskIds: ids as TaskId[], date: props.queueDate! }),
            )
          }
        />
      ) : null}
      <Menu
        title={gt("More bulk actions")}
        actions={[
          { id: "top", title: gt("Move tasks to top"), image: "arrow.up.to.line" },
          {
            id: "delete",
            title: gt("Delete tasks"),
            image: "trash",
            attributes: { destructive: true },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (none) return;
          if (nativeEvent.event === "top") props.onRun((store, ids) => store.reorder(ids, {}));
          else if (nativeEvent.event === "delete")
            Alert.alert(
              gt("{count, plural, one {Delete # task} other {Delete # tasks}}", {
                count: props.selected.length,
              }),
              gt("The selected tasks and their schedules are deleted. This cannot be undone."),
              [
                { text: gt("Cancel"), style: "cancel" },
                {
                  text: gt("Delete", { $context: "button that confirms deleting" }),
                  style: "destructive",
                  onPress: () => props.onRun((store, ids) => store.deleteTasks(ids)),
                },
              ],
            );
        }}
      >
        <RowControl icon="ellipsis" accessibilityLabel={gt("More bulk actions")} disabled={none} />
      </Menu>
      <View className="flex-1" />
      <Button
        label={gt("Done", { $context: "button that leaves select mode" })}
        size="compact"
        tone="text"
        onPress={props.onExit}
      />
    </View>
  );
}

/**
 * The desktop's list row: the title, then the project picker, Mark as done, Archive, Add to
 * queue, Schedule with its count, Open details and More, in that order. A done or archived task
 * offers Restore in place of Mark as done and Archive; in select mode a select toggle takes the
 * place of Open details and More, as on the desktop.
 */
const PlannerTaskRow = memo(function PlannerTaskRow(props: {
  readonly task: PlannerTask;
  readonly routines: boolean;
  readonly canEdit: boolean;
  readonly environmentId: EnvironmentId;
  readonly projects: readonly EnvironmentProject[];
  readonly project: EnvironmentProject | null;
  readonly progress: string | null;
  readonly queueDate: DateKey | null;
  readonly queueDateLabel: string;
  readonly moveTargets: readonly PlannerTask[];
  readonly selectMode: boolean;
  readonly selected: boolean;
  readonly onToggleSelected: () => void;
  readonly store: PlannerStore;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { task, store } = props;
  const finished = isFinishedTask(task);
  const edit = props.canEdit && !task.id.startsWith("pending-");
  const statusLabel =
    task.status !== PERSON_OPEN_STATUS && task.status !== PERSON_DONE_STATUS ? task.status : null;
  const projectChip = (
    <RowControl
      accessibilityLabel={gt("Project, {project}", {
        project: props.project?.title ?? gt("Unknown project"),
      })}
      disabled={!edit}
      picker
      leading={
        <TaskProjectBadge environmentId={props.environmentId} project={props.project} size={18} />
      }
      label={props.project?.title ?? gt("Unknown project")}
    />
  );
  const more = (
    <RowControl icon="ellipsis" accessibilityLabel={gt("More actions")} disabled={!edit} />
  );
  return (
    <View className="gap-2 px-4 py-2.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={task.title}
        accessibilityHint={gt("Opens the task")}
        onPress={props.onOpen}
        className="active:opacity-70"
      >
        <Text
          className={cn(
            "text-base leading-5",
            finished ? "text-foreground-muted line-through" : "text-foreground",
          )}
        >
          {task.title}
        </Text>
      </Pressable>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {edit ? (
          <Menu
            title={gt("Project")}
            actions={props.projects.map((project) => ({
              id: project.id,
              title: project.title,
              state: project.id === task.projectId ? ("on" as const) : ("off" as const),
            }))}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event !== task.projectId)
                void store.updateTask(task.id, { projectId: nativeEvent.event as ProjectId });
            }}
          >
            {projectChip}
          </Menu>
        ) : (
          projectChip
        )}
        {finished ? (
          <RowControl
            icon="arrow.uturn.backward"
            accessibilityLabel={gt("Restore", { $context: "button that unarchives the task" })}
            disabled={!edit}
            onPress={() => void store.restore([task.id])}
          />
        ) : (
          <>
            <RowControl
              icon="checkmark.circle"
              accessibilityLabel={gt("Mark as done")}
              disabled={!edit}
              onPress={() => void store.markDone([task.id])}
            />
            <RowControl
              icon="archivebox"
              accessibilityLabel={gt("Archive", { $context: "button that archives the task" })}
              disabled={!edit}
              onPress={() => void store.archive([task.id])}
            />
          </>
        )}
        {statusLabel ? (
          <Text className="rounded-md bg-subtle px-1.5 py-px text-xs text-foreground-muted">
            {statusLabel}
          </Text>
        ) : null}
        {props.queueDate !== null ? (
          <RowControl
            icon={{ ios: "text.badge.plus", android: "check" }}
            accessibilityLabel={gt("Add to queue for {date}", { date: props.queueDateLabel })}
            disabled={!edit}
            onPress={() =>
              void store.addEntries({ taskIds: [task.id as TaskId], date: props.queueDate! })
            }
          />
        ) : null}
        <RowControl
          icon={{ ios: "calendar", android: "check" }}
          label={props.progress ?? undefined}
          accessibilityLabel={
            props.progress
              ? gt("Schedule ({progress})", { progress: props.progress })
              : gt("Schedule")
          }
          onPress={props.onOpen}
        />
        {props.selectMode ? (
          <RowControl
            icon={props.selected ? "checkmark.circle.fill" : "circle"}
            tintClassName={props.selected ? "accent-primary" : undefined}
            accessibilityLabel={props.selected ? gt("Deselect") : gt("Select")}
            accessibilityState={{ selected: props.selected }}
            onPress={props.onToggleSelected}
          />
        ) : (
          <>
            <RowControl
              icon="arrow.up.left.and.arrow.down.right"
              accessibilityLabel={gt("Open details")}
              onPress={props.onOpen}
            />
            {edit ? (
              <Menu
                title={task.title}
                actions={[
                  { id: "top", title: gt("Move to top"), image: "arrow.up.to.line" },
                  {
                    id: "below",
                    title: props.routines
                      ? gt("Move below another routine")
                      : gt("Move below another task"),
                    image: "arrow.down.to.line",
                    subactions: props.moveTargets.map((target) => ({
                      id: `below:${target.id}`,
                      title: target.title,
                    })),
                  },
                  {
                    id: "delete",
                    title: props.routines ? gt("Delete routine") : gt("Delete task"),
                    image: "trash",
                    attributes: { destructive: true },
                  },
                ]}
                onPressAction={({ nativeEvent }) => {
                  const id = nativeEvent.event;
                  if (id === "top") void store.reorder([task.id], {});
                  else if (id.startsWith("below:"))
                    void store.reorder([task.id], { afterTaskId: id.slice(6) });
                  else if (id === "delete")
                    Alert.alert(
                      props.routines ? gt("Delete routine") : gt("Delete task"),
                      gt('"{title}" and its schedule are deleted. This cannot be undone.', {
                        title: task.title,
                      }),
                      [
                        { text: gt("Cancel"), style: "cancel" },
                        {
                          text: gt("Delete", { $context: "button that confirms deleting" }),
                          style: "destructive",
                          onPress: () => void store.deleteTasks([task.id]),
                        },
                      ],
                    );
                }}
              >
                {more}
              </Menu>
            ) : (
              more
            )}
          </>
        )}
      </View>
    </View>
  );
});

function GateNotice(props: {
  readonly gate: ReturnType<typeof plannerGate>;
  readonly routines: boolean;
}) {
  const gt = useGT();
  const contentTopInset = useContentTopInset();
  if (props.gate === "checking" || props.gate === "ready")
    return (
      <View className="items-center py-12" style={{ paddingTop: contentTopInset + 48 }}>
        <AppActivityIndicator
          colorClassName="accent-icon"
          accessibilityLabel={gt("Loading the planner")}
        />
      </View>
    );
  const copy = {
    noEnvironment: {
      title: gt("Connect a computer"),
      detail: props.routines
        ? gt("Add an environment in Settings to see your routines.")
        : gt("Add an environment in Settings to see your tasks."),
    },
    offline: {
      title: gt("Computer offline"),
      detail: gt(
        "The computer with your tasks isn't reachable right now. The planner opens when it connects.",
      ),
    },
    unavailable: {
      title: gt("Planner unavailable"),
      detail: gt(
        "This computer runs an older Up.computer without the planner. Update it to plan your week here.",
      ),
    },
  }[props.gate];
  return (
    <View className="px-8 py-12" style={{ paddingTop: contentTopInset + 48 }}>
      <EmptyState title={copy.title} detail={copy.detail} variant="plain" />
    </View>
  );
}
