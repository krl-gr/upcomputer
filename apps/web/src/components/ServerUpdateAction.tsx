import type { EnvironmentId, ServerSelfUpdateCapability } from "@t3tools/contracts";
import {
  canOfferRemoteServerSelfUpdate,
  UPCOMPUTER_REMOTE_SERVER_RELEASE_NOTICE,
} from "@t3tools/shared/upcomputerReleasePolicy";

/**
 * Version-skew guidance follows the official release policy. The only supported
 * update path is replacing a bundled backend by updating its Desktop app;
 * npm-backed self-update and copied `t3` commands stay unavailable.
 */
export function ServerUpdateAction({
  selfUpdate,
}: {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly targetVersion: string;
}) {
  if (selfUpdate === "desktop-managed" && canOfferRemoteServerSelfUpdate(selfUpdate)) {
    return (
      <span className="text-muted-foreground text-xs">
        Update the desktop app on that machine to update this server.
      </span>
    );
  }

  return (
    <span className="max-w-md text-muted-foreground text-xs" role="status">
      {UPCOMPUTER_REMOTE_SERVER_RELEASE_NOTICE}
    </span>
  );
}
