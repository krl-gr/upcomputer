"use client";

import { useState } from "react";

import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ProjectImportPanel, type ProjectImportSummary } from "./ProjectImportPanel";

function reportImport(summary: ProjectImportSummary) {
  if (summary.warning !== null) {
    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Some history was not imported",
        description: summary.warning,
      }),
    );
    return;
  }
  toastManager.add(
    stackedThreadToast({
      type: "success",
      title:
        summary.importedThreadCount > 0
          ? `Imported ${summary.importedThreadCount} ${summary.importedThreadCount === 1 ? "conversation" : "conversations"}`
          : "Projects imported",
    }),
  );
}

/** Settings entry point to the same project import onboarding offers. */
export function ProjectImportButton() {
  const environment = usePrimaryEnvironment();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="xs"
        variant="outline"
        disabled={environment === null}
        onClick={() => setOpen(true)}
      >
        Import from Claude Code / Codex
      </Button>
      {environment !== null ? (
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import from Claude Code / Codex</DialogTitle>
            <DialogDescription>
              Add the projects you use with Claude Code and Codex, with their recent conversations.
              Projects you already have get any new conversations. Your Claude Code and Codex files
              are only read, never changed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] min-h-0 flex-col px-6 pb-4">
            {open ? (
              <ProjectImportPanel
                environmentId={environment.environmentId}
                skipLabel="Cancel"
                onSkip={() => setOpen(false)}
                onDone={(summary) => {
                  reportImport(summary);
                  // Stay open so the panel can continue a partial import.
                  if (summary.remainingThreadCount === 0) setOpen(false);
                }}
              />
            ) : null}
          </div>
        </DialogPopup>
      ) : null}
    </Dialog>
  );
}
