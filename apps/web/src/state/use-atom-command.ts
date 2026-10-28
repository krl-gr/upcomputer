import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { errorToastDescription } from "~/components/errors/ErrorDetails";
import { toastManager } from "~/components/ui/toast";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?:
    | string
    | (AtomCommandOptions & {
        /**
         * Shows the failure to the person under this title. Without it a
         * failure only reaches the console, which reads as nothing happening.
         */
        readonly failureToast?: string;
      }),
): (value: W) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);
  const failureToast = typeof options === "string" ? undefined : options?.failureToast;

  return (value: W) =>
    runAtomCommand(registry, command, value, { label, reportFailure, reportDefect }).then(
      (result) => {
        if (
          failureToast !== undefined &&
          AsyncResult.isFailure(result) &&
          !isAtomCommandInterrupted(result)
        ) {
          toastManager.add({
            type: "error",
            title: failureToast,
            description: errorToastDescription(squashAtomCommandFailure(result)),
          });
        }
        return result;
      },
    );
}
