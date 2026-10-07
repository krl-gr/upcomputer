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

/**
 * Confirms handing a person task to agents: from then on every agent whose
 * triggers match starts on it, as on any agent task.
 */
export function ConfirmHandOffDialog(props: {
  readonly open: boolean;
  readonly title: string;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Hand to agents</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${props.title}" becomes an agent task and leaves Mine. An enabled agent whose status, tags and project match starts on it now. Take it back from its window under Agents or All.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Hand to agents
          </Button>
        </AlertDialogFooter>
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
