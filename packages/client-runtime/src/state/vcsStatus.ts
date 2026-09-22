import type { EnvironmentId } from "@upcomputer/contracts";

export interface VcsStatusTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
}
