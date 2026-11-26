import { LegendList } from "@legendapp/list/react-native";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  addDays,
  dateOfKey,
  localeWeekStart,
  todayKey,
  type DateKey,
} from "@t3tools/tasks-client/planner/dates";
import type { PlannerTask } from "@t3tools/tasks-client/planner/pendingOps";
import { progressLabel, weekRangeOf } from "@t3tools/tasks-client/planner/progress";
import {
  PERSON_DONE_STATUS,
  type TaskId,
  type TaskScheduleEntryId,
} from "@t3tools/tasks-contracts/v1";
import { useGT, useLocale } from "gt-react-native";
import { memo, useMemo, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../../components/ui/AppActivityIndicator";
import { SymbolView, type AppSymbolName } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { Chip } from "../../../components/ui/Chip";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Menu } from "../../../components/ui/Menu";
import { useContentTopInset } from "../../../components/ui/useBarInset";
import { cn } from "../../../lib/cn";
import { NativeScrollView } from "../../../native/NativeScrollViewMarker";
import { useNativeColumnLayoutMetrics } from "../../../native/native-layout-metrics";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { useWorkspaceTabs } from "../../layout/workspace/WorkspaceTabsContext";
import { useAppearancePreferences } from "../../settings/appearance/AppearancePreferencesProvider";
import { useTasksAccess } from "../tasksRpc";
import { plannerStoreFor, usePlanner, usePlannerAvailability } from "./plannerData";
import {
  dayEntries,
  daysWithOpenEntries,
  entryMoveTargets,
  plannedOn,
  plannerGate,
  plannerKindOf,
  searchPlannerTasks,
  toggledEntryStatus,
  weekOf,
  type DayEntry,
} from "./plannerState";

const ADD_TO_DAY_ICON: AppSymbolName = { ios: "calendar.badge.plus", android: "check" };

type PlannerRow =
  | { readonly type: "title"; readonly key: string; readonly title: string; readonly count: number }
  | { readonly type: "note"; readonly key: string; readonly text: string }
  | { readonly type: "loading"; readonly key: string }
  | { readonly type: "entry"; readonly key: string; readonly item: DayEntry }
  | { readonly type: "task"; readonly key: string; readonly task: PlannerTask };

/**
 * My tasks and My routines on the phone: the desktop planner's narrow layout, the week on top
 * and the list below. One computer at a time, as the desktop's planner.
 */
export function PlannerView(props: {
  readonly view: "mine" | "routines";
  readonly environmentId: EnvironmentId | null;
  readonly connected: boolean;
  readonly query: string;
  readonly sidebar: boolean;
  /** The view switch and the computer picker, above the planner's own controls. */
  readonly header: ReactNode;
  readonly chips: (action: ReactNode) => ReactNode;
  readonly onCreate: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
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
  const header = (
    <>
      {props.header}
      {props.chips(
        <AddChip
          label={routines ? gt("New routine") : gt("New task")}
          disabled={!canEdit}
          onPress={props.onCreate}
        />,
      )}
    </>
  );
  if (gate !== "ready" || props.environmentId === null)
    return (
      <PlannerShell sidebar={props.sidebar} header={header} rows={[]} renderRow={() => null}>
        <PlannerGateNotice gate={gate} routines={routines} />
      </PlannerShell>
    );
  return (
    <PlannerBody
      key={`${props.environmentId}:${kind}`}
      environmentId={props.environmentId}
      routines={routines}
      canEdit={canEdit}
      query={props.query}
      sidebar={props.sidebar}
      header={header}
      locale={locale}
    />
  );
}

function PlannerBody(props: {
  readonly environmentId: EnvironmentId;
  readonly routines: boolean;
  readonly canEdit: boolean;
  readonly query: string;
  readonly sidebar: boolean;
  readonly header: ReactNode;
  readonly locale: string;
}) {
  const gt = useGT();
  const selectDetail = useSelectWorkspaceDetail();
  const kind = props.routines ? "routine" : "task";
  const store = plannerStoreFor(props.environmentId);
  const weekStartDay = useMemo(() => localeWeekStart(props.locale), [props.locale]);
  const today = todayKey();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const week = weekOf(selectedDate, weekStartDay);
  const progressWindow = props.routines ? weekRangeOf(today, weekStartDay) : null;
  const snapshot = usePlanner({
    store,
    kind,
    weekFrom: week[0]!,
    weekTo: week[6]!,
    progressWindow,
  });
  const tasks = snapshot.active.ids.flatMap((id) => {
    const task = snapshot.view.tasks.get(id);
    return task ? [task] : [];
  });
  const shownTasks = searchPlannerTasks(tasks, props.query);
  const day = dayEntries(snapshot.view.days.get(selectedDate), snapshot.view.tasks, kind);
  const marked = daysWithOpenEntries(snapshot.view.days, snapshot.view.tasks, kind);

  const openTask = (taskId: string, title: string) => {
    Keyboard.dismiss();
    selectDetail({
      name: "Task",
      params: { environmentId: String(props.environmentId), taskId, title },
    });
  };
  const dayTitle =
    selectedDate === today
      ? gt("Today")
      : dateOfKey(selectedDate).toLocaleDateString(props.locale, {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
  const listLoading = snapshot.active.status === "LoadingFirstPage";
  const rows: PlannerRow[] = [
    { type: "title", key: "day", title: dayTitle, count: day.length },
    ...(day.length > 0
      ? day.map((item) => ({ type: "entry" as const, key: `e:${item.entry.id}`, item }))
      : [
          {
            type: "note" as const,
            key: "day-empty",
            text: props.routines
              ? gt("No routines planned for this day.")
              : gt("Nothing planned for this day."),
          },
        ]),
    {
      type: "title",
      key: "list",
      title: props.routines ? gt("Routines") : gt("Tasks"),
      count: shownTasks.length,
    },
    ...(listLoading
      ? [{ type: "loading" as const, key: "list-loading" }]
      : shownTasks.length > 0
        ? shownTasks.map((task) => ({ type: "task" as const, key: `t:${task.id}`, task }))
        : [
            {
              type: "note" as const,
              key: "list-empty",
              text: snapshot.active.error
                ? snapshot.active.error
                : props.query.trim()
                  ? gt("No loaded task matches your search.")
                  : props.routines
                    ? gt("No routines yet. Tap New routine to add a habit or chore you repeat.")
                    : gt(
                        "No tasks yet. Tap New task to add one, or ask any thread to plan the work for you.",
                      ),
            },
          ]),
  ];

  return (
    <PlannerShell
      sidebar={props.sidebar}
      header={
        <>
          {props.header}
          <WeekStrip
            days={week}
            selected={selectedDate}
            today={today}
            marked={marked}
            locale={props.locale}
            onSelect={setSelectedDate}
            onShift={(days) => setSelectedDate(addDays(selectedDate, days))}
            onToday={() => setSelectedDate(today)}
          />
          {snapshot.rangeError ? (
            <Text selectable className="px-4 pb-1 text-sm text-foreground-muted">
              {gt("The planner didn't load: {error}", { error: snapshot.rangeError })}
            </Text>
          ) : null}
        </>
      }
      rows={rows}
      onEndReached={() => {
        if (snapshot.active.status === "CanLoadMore") store.loadMore("active");
      }}
      renderRow={(row) => {
        switch (row.type) {
          case "title":
            return (
              <View className="flex-row items-baseline gap-2 px-4 pb-1 pt-4">
                <Text className="text-sm font-t3-bold text-foreground">{row.title}</Text>
                <Text className="text-xs tabular-nums text-foreground-muted">{row.count}</Text>
              </View>
            );
          case "note":
            return <Text className="px-4 py-2.5 text-sm text-foreground-muted">{row.text}</Text>;
          case "loading":
            return (
              <View className="items-center py-6">
                <AppActivityIndicator
                  colorClassName="accent-icon"
                  accessibilityLabel={props.routines ? gt("Loading routines") : gt("Loading tasks")}
                />
              </View>
            );
          case "entry":
            return (
              <PlannerEntryRow
                item={row.item}
                canEdit={props.canEdit}
                locale={props.locale}
                moveTargets={entryMoveTargets(row.item.entry.date, weekStartDay)}
                onToggle={() =>
                  void store.updateEntry({
                    id: row.item.entry.id as TaskScheduleEntryId,
                    status: toggledEntryStatus(row.item.entry.status),
                  })
                }
                onStatus={(status) =>
                  void store.updateEntry({ id: row.item.entry.id as TaskScheduleEntryId, status })
                }
                onMove={(date) =>
                  void store.moveEntries({
                    ids: [row.item.entry.id as TaskScheduleEntryId],
                    date,
                    placement: { at: "bottom" },
                  })
                }
                onDelete={() => void store.deleteEntries([row.item.entry.id])}
                onOpen={() => openTask(row.item.entry.taskId, row.item.task?.title ?? gt("Task"))}
              />
            );
          case "task":
            return (
              <PlannerTaskRow
                task={row.task}
                routines={props.routines}
                canEdit={props.canEdit}
                progress={progressLabel(snapshot.progress.get(row.task.id))}
                plannedOnDay={plannedOn(day, row.task.id)}
                dayLabel={selectedDate === today ? null : dayTitle}
                onDone={() => void store.markDone([row.task.id])}
                onAddToDay={() =>
                  void store.addEntries({ taskIds: [row.task.id as TaskId], date: selectedDate })
                }
                onOpen={() => openTask(row.task.id, row.task.title)}
              />
            );
        }
      }}
    />
  );
}

/** The list scaffolding the Tasks tab's views share: header, rows, safe areas and insets. */
function PlannerShell(props: {
  readonly sidebar: boolean;
  readonly header: ReactNode;
  readonly rows: readonly PlannerRow[];
  readonly renderRow: (row: PlannerRow) => ReactNode;
  readonly onEndReached?: () => void;
  readonly children?: ReactNode;
}) {
  const workspace = useWorkspaceTabs()!;
  const insets = useSafeAreaInsets();
  const contentTopInset = useContentTopInset();
  const columnSafeBottom = useNativeColumnLayoutMetrics()?.safeArea.bottom;
  const bottomSafeArea =
    Platform.OS === "ios" ? (columnSafeBottom ?? insets.bottom) : insets.bottom;
  return (
    <View className={props.sidebar ? "flex-1 bg-drawer" : "flex-1 bg-screen"}>
      <LegendList
        data={props.rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        estimatedItemSize={56}
        drawDistance={1_000}
        onEndReached={props.onEndReached}
        onEndReachedThreshold={0.5}
        alwaysBounceVertical
        showsVerticalScrollIndicator={Platform.OS !== "android"}
        recycleItems
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        contentInsetAdjustmentBehavior="never"
        contentInset={Platform.OS === "ios" ? { top: contentTopInset } : undefined}
        contentContainerStyle={{
          paddingBottom: Math.max(bottomSafeArea, workspace.bottomClearance),
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <>{props.renderRow(item)}</>}
        ListHeaderComponentStyle={{ zIndex: 1 }}
        ListHeaderComponent={<>{props.header}</>}
        ListEmptyComponent={props.children ? <>{props.children}</> : undefined}
      />
    </View>
  );
}

function AddChip(props: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const { themeAppearance } = useAppearancePreferences();
  return (
    <Chip
      label={props.label}
      icon="plus"
      glass
      colorScheme={themeAppearance}
      disabled={props.disabled}
      accessibilityLabel={props.label}
      onPress={props.onPress}
    />
  );
}

function PlannerGateNotice(props: {
  readonly gate: ReturnType<typeof plannerGate>;
  readonly routines: boolean;
}) {
  const gt = useGT();
  if (props.gate === "checking" || props.gate === "ready")
    return (
      <View className="items-center py-12">
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
    <View className="px-8 py-12">
      <EmptyState title={copy.title} detail={copy.detail} variant="plain" />
    </View>
  );
}

/** The week on top: seven days, today and the chosen day marked, a dot where something is open. */
function WeekStrip(props: {
  readonly days: readonly DateKey[];
  readonly selected: DateKey;
  readonly today: DateKey;
  readonly marked: ReadonlySet<DateKey>;
  readonly locale: string;
  readonly onSelect: (date: DateKey) => void;
  readonly onShift: (days: number) => void;
  readonly onToday: () => void;
}) {
  const gt = useGT();
  const month = dateOfKey(props.selected).toLocaleDateString(props.locale, {
    month: "long",
    year: "numeric",
  });
  const showsToday = props.days.includes(props.today);
  return (
    <View className="gap-2 px-3 pb-1 pt-1">
      <View className="flex-row items-center gap-1 px-1">
        <Text className="min-w-0 flex-1 text-base font-t3-bold text-foreground" numberOfLines={1}>
          {month}
        </Text>
        {showsToday && props.selected === props.today ? null : (
          <Button label={gt("Today")} size="compact" tone="text" onPress={props.onToday} />
        )}
        <WeekArrow
          icon="chevron.left"
          label={gt("Previous week")}
          onPress={() => props.onShift(-7)}
        />
        <WeekArrow icon="chevron.right" label={gt("Next week")} onPress={() => props.onShift(7)} />
      </View>
      <View className="flex-row">
        {props.days.map((date) => {
          const selected = date === props.selected;
          const isToday = date === props.today;
          const day = dateOfKey(date);
          const weekday = day.toLocaleDateString(props.locale, { weekday: "narrow" });
          return (
            <Pressable
              key={date}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={day.toLocaleDateString(props.locale, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              onPress={() => props.onSelect(date)}
              className="flex-1 items-center gap-1 py-1"
            >
              <Text
                className={cn(
                  "text-2xs font-t3-medium",
                  isToday ? "text-adaptive-sky-600-400" : "text-foreground-muted",
                )}
              >
                {weekday}
              </Text>
              <View
                className={cn(
                  "h-9 w-9 items-center justify-center rounded-full",
                  selected && (isToday ? "bg-adaptive-sky-600-400" : "bg-foreground"),
                )}
              >
                <Text
                  className={cn(
                    "text-base tabular-nums",
                    selected
                      ? "font-t3-bold text-screen"
                      : isToday
                        ? "font-t3-bold text-adaptive-sky-600-400"
                        : "text-foreground",
                  )}
                >
                  {day.getDate()}
                </Text>
              </View>
              <View
                className={cn(
                  "h-1 w-1 rounded-full",
                  props.marked.has(date) ? "bg-foreground-muted" : "bg-transparent",
                )}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WeekArrow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center rounded-full active:bg-row-hover"
    >
      <SymbolView name={props.icon} size={16} tintColorClassName="accent-icon-muted" />
    </Pressable>
  );
}

function CheckButton(props: {
  readonly state: "open" | "done" | "skipped";
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const icon: AppSymbolName =
    props.state === "done"
      ? "checkmark.circle.fill"
      : props.state === "skipped"
        ? "slash.circle"
        : "circle";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.state === "done", disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={10}
      className="pt-0.5"
    >
      <SymbolView
        name={icon}
        size={22}
        tintColorClassName={
          props.state === "done" ? "accent-adaptive-emerald-600-400" : "accent-icon-muted"
        }
      />
    </Pressable>
  );
}

const PlannerEntryRow = memo(function PlannerEntryRow(props: {
  readonly item: DayEntry;
  readonly canEdit: boolean;
  readonly locale: string;
  readonly moveTargets: readonly DateKey[];
  readonly onToggle: () => void;
  readonly onStatus: (status: "open" | "done" | "skipped") => void;
  readonly onMove: (date: DateKey) => void;
  readonly onDelete: () => void;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { entry, task } = props.item;
  const handled = entry.status !== "open";
  // An entry just added has no server id until the add returns, so nothing can change it yet.
  const editable = props.canEdit && !entry.id.startsWith("pending-entry-");
  const title = task?.title ?? gt("Loading…");
  const dayName = (date: DateKey) =>
    dateOfKey(date).toLocaleDateString(props.locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
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
  // The native menu opens on tap whatever its child says, so a read-only row gets none.
  const moreButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={gt("More options")}
      disabled={!editable}
      hitSlop={8}
      className={cn("h-7 w-7 items-center justify-center", !editable && "opacity-40")}
    >
      <SymbolView name="ellipsis" size={16} tintColorClassName="accent-icon-muted" />
    </Pressable>
  );
  return (
    <View className="flex-row items-start gap-3 px-4">
      <CheckButton
        state={entry.status}
        label={entry.status === "done" ? gt("Mark as not done") : gt("Mark as done")}
        disabled={!editable}
        onPress={props.onToggle}
      />
      <View className="min-w-0 flex-1 flex-row items-center gap-2 border-b border-border-subtle pb-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={props.onOpen}
          className="min-w-0 flex-1 flex-row items-center gap-2"
        >
          <Text
            numberOfLines={2}
            className={cn(
              "min-w-0 flex-1 text-base leading-5",
              handled ? "text-foreground-muted line-through" : "text-foreground",
            )}
          >
            {title}
          </Text>
          {entry.startTime ? (
            <Text className="text-xs tabular-nums text-foreground-muted">{entry.startTime}</Text>
          ) : null}
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
              {
                id: "move",
                title: gt("Move to another day"),
                image: "calendar",
                subactions: props.moveTargets.map((date) => ({
                  id: `move:${date}`,
                  title: dayName(date),
                })),
              },
              {
                id: "delete",
                title: gt("Remove from this day"),
                image: "trash",
                attributes: { destructive: true },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              const id = nativeEvent.event;
              const status = statusItems.find((item) => item.id === id)?.status;
              if (status) props.onStatus(status);
              else if (id === "next") props.onMove(addDays(entry.date, 1));
              else if (id.startsWith("move:")) props.onMove(id.slice(5));
              else if (id === "delete") props.onDelete();
            }}
          >
            {moreButton}
          </Menu>
        ) : (
          moreButton
        )}
      </View>
    </View>
  );
});

const PlannerTaskRow = memo(function PlannerTaskRow(props: {
  readonly task: PlannerTask;
  readonly routines: boolean;
  readonly canEdit: boolean;
  readonly progress: string | null;
  readonly plannedOnDay: boolean;
  /** Null for today. */
  readonly dayLabel: string | null;
  readonly onDone: () => void;
  readonly onAddToDay: () => void;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const { task } = props;
  const done = task.status === PERSON_DONE_STATUS;
  const addLabel = props.plannedOnDay
    ? props.dayLabel === null
      ? gt("Planned for today")
      : gt("Planned for {day}", { day: props.dayLabel })
    : props.dayLabel === null
      ? gt("Add to today")
      : gt("Add to {day}", { day: props.dayLabel });
  return (
    <View className="flex-row items-start gap-3 px-4">
      {props.routines ? (
        <View className="pt-0.5">
          <SymbolView
            name={{ ios: "repeat", android: "check" }}
            size={20}
            tintColorClassName="accent-icon-muted"
          />
        </View>
      ) : (
        <CheckButton
          state={done ? "done" : "open"}
          label={gt("Mark as done")}
          disabled={!props.canEdit || done}
          onPress={props.onDone}
        />
      )}
      <View className="min-w-0 flex-1 flex-row items-center gap-2 border-b border-border-subtle pb-2.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[task.title, props.progress].filter(Boolean).join(", ")}
          onPress={props.onOpen}
          className="min-w-0 flex-1 gap-0.5"
        >
          <Text numberOfLines={2} className="text-base leading-5 text-foreground">
            {task.title}
          </Text>
          {props.progress ? (
            <Text className="text-xs tabular-nums text-foreground-muted">
              {props.routines
                ? gt("{progress} this week", { progress: props.progress })
                : gt("{progress} planned days done", { progress: props.progress })}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          accessibilityState={{ disabled: !props.canEdit || props.plannedOnDay }}
          disabled={!props.canEdit || props.plannedOnDay}
          onPress={props.onAddToDay}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full active:bg-row-hover"
        >
          <SymbolView
            name={
              props.plannedOnDay
                ? { ios: "calendar.badge.checkmark", android: "check" }
                : ADD_TO_DAY_ICON
            }
            size={18}
            tintColorClassName={
              props.plannedOnDay ? "accent-adaptive-emerald-600-400" : "accent-icon-muted"
            }
          />
        </Pressable>
      </View>
    </View>
  );
});
