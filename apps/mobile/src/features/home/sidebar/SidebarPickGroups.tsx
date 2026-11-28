import { useNavigation } from "@react-navigation/native";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import type { ReactNode } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { EnvironmentMachineSymbol } from "../../../components/EnvironmentMachineSymbol";
import { UpIcon } from "../../../components/up-icons/UpIcon";
import { AppText as Text } from "../../../components/ui/AppText";
import { Menu } from "../../../components/ui/Menu";
import { useControlTheme } from "../../../components/ui/useControlTheme";
import { cn } from "../../../lib/cn";
import { copyTextWithHaptic } from "../../../lib/copyTextWithHaptic";
import { openSettings } from "../../settings/settings-navigation";
import { TaskProjectBadge } from "../../tasks/TaskProjectBadge";
import { NoProjectIcon } from "./NoProjectIcon";
import { ThreadSwipeable } from "../thread-swipe-actions";
import { SidebarGroupHeader } from "./SidebarGroupHeader";
import { toggleSidebarGroup, useSidebarGroupsOpen } from "./sidebarGroupsOpen";
import { previewProjects } from "./sidebarListItems";

export interface SidebarComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly machine: EnvironmentMachineKind | undefined;
}

export interface SidebarProject {
  readonly key: string;
  readonly label: string;
  readonly project: EnvironmentProject | null;
}

function PickRow(props: {
  readonly leading: ReactNode;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className={cn(
        "mx-2 min-h-[48px] flex-row items-center gap-3 rounded-xl px-3 py-2.5",
        props.selected ? "bg-thread-selected" : "bg-screen active:bg-row-hover",
      )}
    >
      <View className="w-[22px] items-center">{props.leading}</View>
      <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
      {props.trailing}
    </Pressable>
  );
}

function AllIcon() {
  return <UpIcon name="grid-2x2" size={22} tintColorClassName="accent-icon-muted" />;
}

/** The desktop sidebar's Computers group, shown from a second computer on. */
export function SidebarComputersGroup(props: {
  readonly computers: ReadonlyArray<SidebarComputer>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onSelect: (environmentId: EnvironmentId | null) => void;
}) {
  const gt = useGT();
  const open = useSidebarGroupsOpen().computers;
  if (props.computers.length < 2) return null;
  const picked = props.computers.find(
    (computer) => computer.environmentId === props.selectedEnvironmentId,
  );
  return (
    <View>
      <SidebarGroupHeader
        title={gt("Computers")}
        open={open}
        pick={picked?.label ?? null}
        onToggle={() => toggleSidebarGroup("computers")}
      />
      {open ? (
        <>
          <PickRow
            leading={<AllIcon />}
            label={gt("All computers")}
            selected={props.selectedEnvironmentId === null}
            onPress={() => props.onSelect(null)}
          />
          {props.computers.map((computer) => (
            <PickRow
              key={computer.environmentId}
              leading={
                computer.machine ? (
                  <EnvironmentMachineSymbol
                    kind={computer.machine}
                    size={18}
                    tintColorClassName="accent-icon-muted"
                  />
                ) : (
                  <UpIcon name="monitor" size={22} tintColorClassName="accent-icon-muted" />
                )
              }
              label={computer.label}
              selected={computer.environmentId === props.selectedEnvironmentId}
              onPress={() => props.onSelect(computer.environmentId)}
              trailing={
                <View
                  accessibilityLabel={computer.connected ? gt("Online") : gt("Offline")}
                  className={cn(
                    "size-2 rounded-full",
                    computer.connected ? "bg-emerald-500" : "border border-foreground-muted",
                  )}
                />
              }
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

/** The desktop sidebar's Projects group: picking one narrows the chats to it. */
export function SidebarProjectsGroup(props: {
  readonly projects: ReadonlyArray<SidebarProject>;
  readonly selectedKey: string | null;
  readonly onSelect: (key: string | null) => void;
  readonly onNewChat: (project: EnvironmentProject) => void;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const { colors } = useControlTheme();
  const open = useSidebarGroupsOpen().projects;
  const picked = props.projects.find((project) => project.key === props.selectedKey);
  const shown = previewProjects(props.projects, props.selectedKey);
  const hidden = props.projects.filter((project) => !shown.includes(project));
  const menuFor = (project: EnvironmentProject) => [
    {
      id: "new-chat",
      title: gt("New chat in {project}", { project: project.title }),
      image: "square.and.pencil",
    },
    {
      id: "actions",
      title: "",
      displayInline: true,
      subactions: [
        { id: "settings", title: gt("Project settings"), image: "gearshape" },
        { id: "copy-path", title: gt("Copy path"), image: "doc.on.doc" },
      ],
    },
  ];
  const runMenu = (project: EnvironmentProject, event: string) => {
    if (event === "new-chat") props.onNewChat(project);
    if (event === "settings") openSettings(navigation, "SettingsProjectOverview");
    if (event === "copy-path") copyTextWithHaptic(project.workspaceRoot);
  };
  return (
    <View>
      <SidebarGroupHeader
        title={gt("Projects")}
        open={open}
        pick={picked?.label ?? null}
        onToggle={() => toggleSidebarGroup("projects")}
        action={{
          icon: "plus",
          label: gt("Add project"),
          onPress: () => navigation.navigate("AddProject"),
        }}
      />
      {open ? (
        <>
          <PickRow
            leading={<AllIcon />}
            label={gt("All projects")}
            selected={props.selectedKey === null}
            onPress={() => props.onSelect(null)}
          />
          {shown.map(({ key, label, project }) => {
            const row = (
              <PickRow
                leading={
                  project?.isScratch ? (
                    <NoProjectIcon size={22} />
                  ) : project ? (
                    <TaskProjectBadge
                      environmentId={project.environmentId}
                      project={project}
                      size={22}
                    />
                  ) : null
                }
                label={label}
                selected={key === props.selectedKey}
                onPress={() => props.onSelect(key)}
              />
            );
            if (!project) return <View key={key}>{row}</View>;
            return (
              <ThreadSwipeable
                key={key}
                dormant={false}
                threadKey={`project:${key}`}
                backgroundColor={colors["--color-screen"]}
                compactActions
                fullSwipeAction="primary"
                fullSwipeWidth={width - 32}
                onDelete={() => undefined}
                primaryAction={{
                  accessibilityLabel: gt("New chat in {project}", { project: label }),
                  icon: "up.compose-note",
                  label: gt("New chat"),
                  onPress: () => props.onNewChat(project),
                }}
                secondaryAction={{
                  accessibilityLabel: gt("Project actions"),
                  icon: "up.more-horizontal",
                  label: gt("More"),
                  menu: {
                    actions: menuFor(project).slice(1),
                    onPressAction: ({ nativeEvent }) => runMenu(project, nativeEvent.event),
                  },
                  onPress: () => undefined,
                }}
                threadTitle={label}
              >
                {() => (
                  <Menu
                    accessibilityLabel={label}
                    actions={menuFor(project)}
                    onPressAction={({ nativeEvent }) => runMenu(project, nativeEvent.event)}
                    shouldOpenOnLongPress
                  >
                    {row}
                  </Menu>
                )}
              </ThreadSwipeable>
            );
          })}
          {hidden.length > 0 ? (
            <Menu
              title={gt("Projects")}
              actions={hidden.map((project) => ({ id: project.key, title: project.label }))}
              onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
            >
              <PickRow
                leading={
                  <UpIcon name="more-horizontal" size={20} tintColorClassName="accent-icon-muted" />
                }
                label={gt("More", { $context: "row that lists the other projects" })}
                selected={false}
              />
            </Menu>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
