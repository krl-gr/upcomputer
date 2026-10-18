import { SquarePenIcon } from "lucide-react";

import { Button } from "../../../../apps/web/src/components/ui/button.tsx";
import { useScratchProject } from "../../../../apps/web/src/hooks/useScratchProject.ts";
import { usePrimaryEnvironmentId } from "../../../../apps/web/src/state/environments.ts";

/**
 * An empty Tasks or Agents list: what fills it, and a way into a chat without
 * a project, where a thread can plan the work. The button hides when no
 * environment offers such a chat, as the sidebar's New thread does.
 */
export function StartThreadEmptyState(props: { readonly title: string; readonly body: string }) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTarget = scratchEnvironmentId(primaryEnvironmentId);
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <p className="text-sm font-medium text-foreground">{props.title}</p>
      <p className="max-w-md text-sm text-balance text-muted-foreground">{props.body}</p>
      {scratchTarget === null ? null : (
        <Button
          className="mt-4"
          size="sm"
          variant="outline"
          onClick={() => void startScratchThread(scratchTarget)}
        >
          <SquarePenIcon />
          Start a thread
        </Button>
      )}
    </div>
  );
}
