import { createSourceControlEnvironmentAtoms } from "@upcomputer/client-runtime/state/source-control";

import { connectionAtomRuntime } from "../connection/runtime";

export const sourceControlEnvironment = createSourceControlEnvironmentAtoms(connectionAtomRuntime);
