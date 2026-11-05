import { useAtomValue } from "@effect/atom-react";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { InfoIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { APP_VERSION } from "../branding";
import { EnvironmentMachineIcon } from "../components/EnvironmentMachineIcon";
import { OutdatedServerUpdateAction, ServerUpdateAction } from "../components/ServerUpdateAction";
import { CompactSidebarButton, CompactSidebarPill } from "../components/sidebar/CompactSidebarPill";
import { Button } from "../components/ui/button";
import { Collapsible, CollapsiblePanel } from "../components/ui/collapsible";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { SidebarCompactTooltip } from "../adaptiveSidebar/adaptiveSidebar";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { cn } from "../lib/utils";
import {
  SIDEBAR_ICON_SIZE,
  SIDEBAR_MENU_SCOPE,
  SIDEBAR_SECTION_GAP,
  SIDEBAR_SECTION_HEADER_GAP,
} from "../sidebarMetrics/sidebarMetrics";
import { SidebarSectionHeader } from "../sidebarProjects/SidebarSectionHeader";
import { AllProjectsIcon } from "../sidebarProjects/sidebarProjectIcons";
import {
  RUN_COUNT_PILL,
  RUN_COUNT_PILL_SURFACE,
  RunCountNumbers,
  onLightRunCountGroup,
  runCountSummary,
} from "../sidebarThreadRow/runCountBadge";
import {
  SidebarListRowEnd,
  sidebarListRowActionClassName,
} from "../sidebarThreadRow/sidebarListRow";
import { serverEnvironment } from "../state/server";
import {
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
} from "../versionSkew";
import {
  markSidebarComputerRouteRevealed,
  selectSidebarComputer,
  useSidebarComputerSelection,
} from "./sidebarComputerSelection";
import {
  computerRunCountGroups,
  computerShortcutChoice,
  computerShortcutLabel,
  type ComputerChoice,
} from "./sidebarComputers.logic";
import {
  useSidebarComputers,
  type ComputerStatus,
  type SidebarComputer,
} from "./useSidebarComputers";
import "./sidebarComputers.css";

const OPEN_STORAGE_KEY = "upcomputer:sidebar-computers-open";

const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

const STATUS_DOT_CLASS: Record<ComputerStatus, string> = {
  online: "bg-success",
  outdated: "bg-warning",
  connecting: "bg-info",
  offline: "bg-sidebar ring-1 ring-inset ring-muted-foreground",
};

/** A computer's machine icon with its status dot; All computers shows four tiles. */
function ComputerIcon(props: { readonly computer: SidebarComputer | null }) {
  const { computer } = props;
  if (computer === null) return <AllProjectsIcon />;
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", SIDEBAR_ICON_SIZE)}>
      <EnvironmentMachineIcon kind={computer.machine} className={SIDEBAR_ICON_SIZE} />
      <span
        aria-hidden
        data-computer-status={computer.status}
        className={cn(
          "absolute -right-0.5 -bottom-0.5 size-1.75 rounded-full ring-2 ring-sidebar",
          STATUS_DOT_CLASS[computer.status],
        )}
      />
    </span>
  );
}

/**
 * Everything the section shows and does, shared by the sidebar section and the
 * compact pill: the computers, the shortcuts, and following the open thread to
 * its computer.
 */
function useComputers() {
  const selection = useSidebarComputerSelection();
  const computers = useSidebarComputers(selection.shown ? selection.computerIds : []);
  const { choice, routeKey, revealsRoute, computerIds, shown } = selection;
  const selected =
    choice === "all"
      ? null
      : (computers.find((computer) => computer.environmentId === choice) ?? null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the followed route in the selection store, so a later pick holds while that thread stays open
  useEffect(() => {
    if (!shown || routeKey === null) return;
    markSidebarComputerRouteRevealed(routeKey, revealsRoute ? choice : null);
  }, [choice, revealsRoute, routeKey, shown]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for the window-wide computer shortcuts
  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const next = computerShortcutChoice(event, computerIds, isMac);
      if (next === null) return;
      event.preventDefault();
      selectSidebarComputer(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [computerIds, shown]);

  return { shown, choice, computers, selected };
}

/** A tooltip for icon-only forms, where the row's counts and info button are hidden. */
function compactLabel(computer: SidebarComputer): string {
  const groups = computerRunCountGroups(computer.counts);
  return [computer.name, computer.description, groups.length > 0 ? runCountSummary(groups) : null]
    .filter((part): part is string => part !== null)
    .join("\n");
}

/**
 * The narrow sidebar's pill over a computer's icon, the look of a bot's run pill. A 40px
 * target has room for a few numbers only, so it shows what needs the person: approvals,
 * input and unseen failures.
 */
function ComputerCountPill(props: { readonly computer: SidebarComputer }) {
  const groups = computerRunCountGroups({ ...props.computer.counts, working: 0 });
  if (groups.length === 0) return null;
  return (
    <span
      aria-hidden
      data-computer-count-pill={props.computer.environmentId}
      className={cn("pointer-events-none", RUN_COUNT_PILL)}
    >
      <RunCountNumbers groups={groups.map(onLightRunCountGroup)} />
    </span>
  );
}

/**
 * The hidden sidebar's column has no room beside a computer's 32px button, so its corner shows
 * one number: the most urgent kind's, approvals before input before failures.
 */
function ComputerCountBadge(props: { readonly computer: SidebarComputer }) {
  const [urgent] = computerRunCountGroups({ ...props.computer.counts, working: 0 });
  if (urgent === undefined) return null;
  return (
    <span
      aria-hidden
      data-computer-count-pill={props.computer.environmentId}
      className={cn(
        "pointer-events-none absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-3xs leading-none font-semibold tabular-nums",
        RUN_COUNT_PILL_SURFACE,
        onLightRunCountGroup(urgent).className,
      )}
    >
      {urgent.count}
    </span>
  );
}

/**
 * The sidebar's Computers section, above Projects: All computers, this
 * computer, then the others. The selected row filters the sidebar, Bots,
 * Tasks and Workers. Only shown once a second computer is saved or connected.
 */
export function SidebarComputersSection() {
  const { shown, choice, computers, selected } = useComputers();
  const [open, setOpen] = useLocalStorage(OPEN_STORAGE_KEY, true, Schema.Boolean);
  if (!shown) return null;
  return (
    <div
      data-sidebar-computers=""
      // A picked computer that cannot connect: `sidebarComputers.css` dims its cached rows.
      data-stale={selected?.stale === true}
    >
      <Collapsible open={open}>
        <div className={SIDEBAR_SECTION_GAP}>
          <SidebarSectionHeader
            title={open || selected === null ? "Computers" : `Computers · ${selected.name}`}
            open={open}
            onToggle={() => setOpen(!open)}
            testId="sidebar-computers-toggle"
          />
        </div>
        {/* Each count pill rises above its compact target, over the panel's top edge. */}
        <CollapsiblePanel className="[[data-sidebar-compact=true]_&]:overflow-visible">
          <div className={cn(SIDEBAR_SECTION_HEADER_GAP, SIDEBAR_MENU_SCOPE)}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarCompactTooltip label="All computers">
                  <SidebarMenuButton
                    data-computer="all"
                    data-track="sidebar.computer"
                    isActive={choice === "all"}
                    onClick={() => selectSidebarComputer("all")}
                  >
                    <AllProjectsIcon />
                    <span className="flex-1 truncate">All computers</span>
                  </SidebarMenuButton>
                </SidebarCompactTooltip>
              </SidebarMenuItem>
              {computers.map((computer, index) => (
                <SidebarMenuItem key={computer.environmentId}>
                  <ComputerRow
                    computer={computer}
                    shortcut={computerShortcutLabel(index + 1, isMac)}
                    isActive={choice === computer.environmentId}
                  />
                  {/* Placed as a bot's run pill: right of centre, moving left rather than past the column. */}
                  <span className="pointer-events-none absolute -top-[7px] left-[calc(50%-20px)] hidden w-16 [[data-sidebar-compact=true]_&]:flex">
                    <span className="basis-9" />
                    <ComputerCountPill computer={computer} />
                  </span>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

/**
 * One computer: its icon with the status dot, its name, and its counts in the
 * sidebar's run count badge. Hover reveals the info button, whose popover
 * holds its status, version and actions.
 */
function ComputerRow(props: {
  readonly computer: SidebarComputer;
  readonly shortcut: string | null;
  readonly isActive: boolean;
}) {
  const { computer, shortcut, isActive } = props;
  const [infoOpen, setInfoOpen] = useState(false);
  const groups = computerRunCountGroups(computer.counts);
  // The popover is portaled, but its React events still bubble through the
  // row; only events from the row itself, outside its button, select it.
  const isRowEvent = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    const target = event.target as Element;
    return event.currentTarget.contains(target) && target.closest("button") === null;
  };
  return (
    <Popover open={infoOpen} onOpenChange={setInfoOpen}>
      <SidebarCompactTooltip label={compactLabel(computer)}>
        <SidebarMenuButton
          isActive={isActive}
          data-computer={computer.environmentId}
          data-track="sidebar.computer"
          render={
            <div
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              className={cn("group/sidebar-row", infoOpen && !isActive && "bg-sidebar-row-hover")}
            />
          }
          onClick={(event) => {
            if (isRowEvent(event)) selectSidebarComputer(computer.environmentId);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            selectSidebarComputer(computer.environmentId);
          }}
        >
          <ComputerIcon computer={computer} />
          <span className={cn("flex-1 truncate", computer.stale && "opacity-55")}>
            {computer.name}
          </span>
          <SidebarListRowEnd
            pinned={infoOpen}
            action={
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    aria-label={`About ${computer.name}`}
                    data-computer-info={computer.environmentId}
                    className={sidebarListRowActionClassName(infoOpen)}
                  />
                }
              >
                <InfoIcon />
              </PopoverTrigger>
            }
          >
            {groups.length > 0 ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className="inline-flex items-center gap-1 opacity-80"
                      aria-label={runCountSummary(groups)}
                    />
                  }
                >
                  <RunCountNumbers groups={groups} />
                </TooltipTrigger>
                <TooltipPopup side="top">{runCountSummary(groups)}</TooltipPopup>
              </Tooltip>
            ) : null}
          </SidebarListRowEnd>
        </SidebarMenuButton>
      </SidebarCompactTooltip>
      <PopoverPopup side="right" align="start" padding="compact" width="sm">
        <ComputerInfo computer={computer} shortcut={shortcut} />
      </PopoverPopup>
    </Popover>
  );
}

/** What the info popover says about a computer and what it offers. */
function ComputerInfo(props: {
  readonly computer: SidebarComputer;
  readonly shortcut: string | null;
}) {
  const { computer, shortcut } = props;
  const navigate = useNavigate();
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(computer.environmentId));
  const { presentation } = computer;
  const versionMismatch = resolveServerConfigVersionMismatch(presentation.serverConfig);
  const updating = updateState.status === "running";
  const updateLabel = updateState.status === "failed" ? "Retry update" : "Update";
  const groups = computerRunCountGroups(computer.counts);
  const note =
    computer.status === "offline"
      ? "The sidebar shows what it had when it was last connected. New chats and bots wait until it is back."
      : computer.unsupported
        ? "It runs an older Up.computer that can't connect. The sidebar shows what it had before; update it to see the rest."
        : computer.status === "outdated"
          ? `It runs Up.computer ${computer.serverVersion ?? "an older version"}. Update it to ${APP_VERSION} so everything works.`
          : null;
  return (
    <div className="flex flex-col gap-2 text-xs" data-computer-info-popup={computer.environmentId}>
      <div className="flex min-w-0 items-center gap-2">
        <ComputerIcon computer={computer} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{computer.name}</span>
      </div>
      <div className="flex flex-col gap-1">
        <InfoLine label="Status">
          <span className={cn(computer.status === "outdated" && "text-warning-foreground")}>
            {computer.description}
          </span>
        </InfoLine>
        {groups.map((group) => (
          <InfoLine key={group.label} label={group.label}>
            <span className={cn("tabular-nums", group.className)}>{group.count}</span>
          </InfoLine>
        ))}
        {shortcut !== null ? <InfoLine label="Shortcut">{shortcut}</InfoLine> : null}
      </div>
      {note !== null ? <p className="text-muted-foreground">{note}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-1">
        {computer.unsupported && presentation.entry.serverUpdateRequired === true && !updating ? (
          <OutdatedServerUpdateAction
            environmentId={computer.environmentId}
            serverLabel={computer.name}
            fromVersion={undefined}
            targetVersion={APP_VERSION}
            label={updateLabel}
          />
        ) : null}
        {!computer.unsupported && computer.status === "outdated" && versionMismatch && !updating ? (
          <ServerUpdateAction
            environmentId={computer.environmentId}
            serverLabel={computer.name}
            selfUpdate={resolveServerSelfUpdateCapability(presentation.serverConfig)}
            installation={presentation.serverConfig?.environment.capabilities.serverInstallation}
            desktopAppUpdate={supportsDesktopAppUpdate(presentation.serverConfig)}
            targetVersion={versionMismatch.clientVersion}
            label={updateLabel}
          />
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void navigate({ to: "/settings/connections" })}
        >
          Connections
        </Button>
      </div>
    </div>
  );
}

function InfoLine(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{props.label}</span>
      <span className="min-w-0 truncate text-muted-foreground">{props.children}</span>
    </div>
  );
}

/** The section as the compact sidebar's pill: All computers, then each computer with its counts. */
export function CompactSidebarComputers() {
  const { shown, choice, computers } = useComputers();
  if (!shown) return null;
  const select = (next: ComputerChoice) => () => selectSidebarComputer(next);
  return (
    <CompactSidebarPill label="Computers">
      <CompactSidebarButton
        label="All computers"
        isActive={choice === "all"}
        data-computer="all"
        data-track="sidebar.computer"
        onClick={select("all")}
      >
        <AllProjectsIcon />
      </CompactSidebarButton>
      {computers.map((computer) => (
        // The round button clips what leaves it, so the pill is its sibling.
        <span key={computer.environmentId} className="relative flex">
          <CompactSidebarButton
            label={computer.name}
            tooltip={<span className="whitespace-pre-line">{compactLabel(computer)}</span>}
            isActive={choice === computer.environmentId}
            data-computer={computer.environmentId}
            data-track="sidebar.computer"
            onClick={select(computer.environmentId)}
          >
            <ComputerIcon computer={computer} />
          </CompactSidebarButton>
          <ComputerCountBadge computer={computer} />
        </span>
      ))}
    </CompactSidebarPill>
  );
}
