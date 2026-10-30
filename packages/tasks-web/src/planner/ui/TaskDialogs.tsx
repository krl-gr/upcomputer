import { useState } from "react";

import { Button } from "../../../../../apps/web/src/components/ui/button.tsx";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../../../apps/web/src/components/ui/alert-dialog.tsx";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../../../../apps/web/src/components/ui/dialog.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../../../../apps/web/src/components/ui/select.tsx";
import type { PlannerTask } from "../data/pendingOps.ts";

/** Confirms deleting tasks or entries; deleting a task also deletes its entries. */
export function ConfirmDeleteDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

const ANY_AGENT = "any";

function HandOffBody(props: {
  readonly title: string;
  readonly agents: readonly { readonly id: string; readonly name: string }[];
  readonly onConfirm: (agentId: string | null) => void;
  readonly onClose: () => void;
}) {
  // One agent is the obvious pick; with several the person chooses.
  const [choice, setChoice] = useState<string | null>(
    props.agents.length === 1 ? props.agents[0]!.id : props.agents.length === 0 ? ANY_AGENT : null,
  );
  const agent = props.agents.find(({ id }) => id === choice);
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Hand to a worker</AlertDialogTitle>
        <AlertDialogDescription>
          {agent
            ? `"${props.title}" moves from your planner to Workers with ${agent.name}'s start tags, so ${agent.name} starts on it. You can take it back from its details there.`
            : `"${props.title}" becomes a worker task and moves from your planner to Workers. An enabled worker whose status, tags and project match starts on it now. You can take it back from its details there.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {props.agents.length > 0 ? (
        <div className="px-6 pb-6">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger aria-label="Worker">
              <SelectValue>
                {choice === ANY_AGENT ? "No particular worker" : (agent?.name ?? "Choose a worker")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {props.agents.map(({ id, name }) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
              <SelectItem value={ANY_AGENT}>No particular worker</SelectItem>
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
        <Button
          disabled={choice === null}
          onClick={() => {
            props.onConfirm(agent ? agent.id : null);
            props.onClose();
          }}
        >
          {agent ? `Hand to ${agent.name}` : "Hand to workers"}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Confirms handing a person task to agents, to a chosen agent of its project
 * or to whichever agent's triggers match, as on any agent task.
 */
export function ConfirmHandOffDialog(props: {
  readonly open: boolean;
  readonly title: string;
  /** The agents that can take it, by name. */
  readonly agents: readonly { readonly id: string; readonly name: string }[];
  readonly onConfirm: (agentId: string | null) => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogPopup>
        <HandOffBody
          title={props.title}
          agents={props.agents}
          onConfirm={props.onConfirm}
          onClose={() => props.onOpenChange(false)}
        />
      </AlertDialogPopup>
    </AlertDialog>
  );
}

/**
 * Wande's "Move below another task" and "Move tasks under…": pick the task
 * the moved ones go under. The last loaded row is not offered while more rows
 * are unloaded, since "under it" would land among the unloaded ones.
 */
export function MoveBelowDialog(props: {
  readonly open: boolean;
  readonly movingCount: number;
  readonly candidates: readonly PlannerTask[];
  readonly onPick: (taskId: string) => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {props.movingCount === 1
              ? "Move below another task"
              : `Move ${props.movingCount} tasks under…`}
          </DialogTitle>
          <DialogDescription>Pick the task they go under.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {props.candidates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No other tasks to move under.
            </p>
          ) : (
            <div className="flex flex-col">
              {props.candidates.map((task) => (
                <Button
                  key={task.id}
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    props.onPick(task.id);
                    props.onOpenChange(false);
                  }}
                >
                  <span className="truncate">{task.title}</span>
                </Button>
              ))}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
