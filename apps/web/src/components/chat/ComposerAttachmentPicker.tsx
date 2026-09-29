import type { ProjectId, ThreadId } from "@upcomputer/contracts";
import {
  ArrowLeftIcon,
  FilesIcon,
  GitBranchIcon,
  ImagePlusIcon,
  PaperclipIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Project, ThreadShell } from "../../types";
import { cn } from "~/lib/utils";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COMPOSER_CONTROL_ICON_TRIGGER_CLASS } from "./composerControlStyles";

interface ComposerAttachmentPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: ReadonlyArray<ThreadShell>;
  projectById: ReadonlyMap<ProjectId, Project>;
  search: string;
  onSearchChange: (search: string) => void;
  highlightedSourceId: ThreadId | null;
  onHighlightedSourceIdChange: (sourceId: ThreadId | null) => void;
  attachingSourceId: ThreadId | null;
  chatContextDisabledReason: string | null;
  onPickImages: () => void;
  onPickFileSystemEntries: () => void;
  onSelectSource: (sourceId: ThreadId) => void | Promise<void>;
}

type AttachmentPickerView = "menu" | "chat-context";

const TRIGGER_LABEL = "Add attachment";

export function ComposerAttachmentPicker({
  open,
  onOpenChange,
  candidates,
  projectById,
  search,
  onSearchChange,
  highlightedSourceId,
  onHighlightedSourceIdChange,
  attachingSourceId,
  chatContextDisabledReason,
  onPickImages,
  onPickFileSystemEntries,
  onSelectSource,
}: ComposerAttachmentPickerProps) {
  const [view, setView] = useState<AttachmentPickerView>("menu");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setView("menu");
  }, [open]);

  useEffect(() => {
    if (view !== "chat-context" || !highlightedSourceId || !listRef.current) return;
    listRef.current
      .querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(highlightedSourceId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedSourceId, view]);

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setView("menu");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedSourceId) void onSelectSource(highlightedSourceId);
      return;
    }
    if ((event.key !== "ArrowDown" && event.key !== "ArrowUp") || candidates.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = candidates.findIndex((thread) => thread.id === highlightedSourceId);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      currentIndex < 0
        ? event.key === "ArrowDown"
          ? 0
          : candidates.length - 1
        : (currentIndex + delta + candidates.length) % candidates.length;
    onHighlightedSourceIdChange(candidates[nextIndex]?.id ?? null);
  };

  const runMenuAction = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip open={open ? false : undefined}>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={TRIGGER_LABEL}
                  className={COMPOSER_CONTROL_ICON_TRIGGER_CLASS}
                />
              }
            />
          }
        >
          <PaperclipIcon className="size-4" />
        </PopoverTrigger>
        <TooltipPopup side="top">{TRIGGER_LABEL}</TooltipPopup>
      </Tooltip>

      <PopoverPopup
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(calc(100vw-2rem),28rem)] gap-0 overflow-hidden p-0 before:hidden [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
      >
        {view === "menu" ? (
          <div className="p-1.5" aria-label="Attachment options">
            <AttachmentAction
              icon={ImagePlusIcon}
              title="Images"
              description="Attach one or more images to this message."
              onClick={() => runMenuAction(onPickImages)}
            />
            <AttachmentAction
              icon={FilesIcon}
              title="Files or folders"
              description="Add workspace paths as context using the desktop picker."
              onClick={() => runMenuAction(onPickFileSystemEntries)}
            />
            <AttachmentAction
              icon={GitBranchIcon}
              title="Chat context"
              description={
                chatContextDisabledReason ?? "Attach a bounded snapshot of another conversation."
              }
              disabled={chatContextDisabledReason !== null}
              onClick={() => {
                onSearchChange("");
                setView("chat-context");
              }}
            />
          </div>
        ) : (
          <>
            <div className="border-border/60 border-b px-3.5 py-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Back to attachment options"
                  className="-ml-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setView("menu")}
                >
                  <ArrowLeftIcon className="size-4" />
                </button>
                <div>
                  <div className="text-sm font-medium">Attach chat snapshot</div>
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    A bounded copy is sent with future turns.
                  </div>
                </div>
              </div>
            </div>

            <div className="border-border/60 border-b px-3.5">
              <Input
                unstyled
                autoFocus
                value={search}
                placeholder="Search chats, projects, paths"
                className="h-10 w-full bg-transparent text-sm"
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            <div
              ref={listRef}
              className="max-h-72 overflow-y-auto p-1.5 [scrollbar-gutter:stable_both-edges]"
            >
              {candidates.length === 0 ? (
                <div className="px-3 py-8 text-center text-muted-foreground/70 text-sm">
                  No chats available to attach.
                </div>
              ) : (
                candidates.map((thread) => {
                  const project = projectById.get(thread.projectId);
                  const highlighted = highlightedSourceId === thread.id;
                  const attaching = attachingSourceId === thread.id;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      data-thread-id={thread.id}
                      aria-current={highlighted ? "true" : undefined}
                      disabled={attachingSourceId !== null}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-64",
                        highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                      )}
                      onMouseMove={() => {
                        if (!highlighted) onHighlightedSourceIdChange(thread.id);
                      }}
                      onClick={() => void onSelectSource(thread.id)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-sm">{thread.title}</span>
                        <span className="truncate text-muted-foreground/70 text-xs">
                          {project
                            ? `${project.title} · ${project.workspaceRoot}`
                            : "Unknown project"}
                        </span>
                      </span>
                      {attaching ? (
                        <span className="shrink-0 text-muted-foreground/60 text-xs">Attaching</span>
                      ) : thread.archivedAt ? (
                        <span className="shrink-0 text-muted-foreground/60 text-xs">Archived</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function AttachmentAction({
  icon: Icon,
  title,
  description,
  disabled = false,
  onClick,
}: {
  icon: typeof ImagePlusIcon;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
      onClick={onClick}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-sm">{title}</span>
        <span className="text-muted-foreground text-xs leading-relaxed">{description}</span>
      </span>
    </button>
  );
}
