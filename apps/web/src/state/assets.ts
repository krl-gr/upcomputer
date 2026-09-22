import { createAssetEnvironmentAtoms } from "@upcomputer/client-runtime/state/assets";

import { connectionAtomRuntime } from "../connection/runtime";

export const assetEnvironment = createAssetEnvironmentAtoms(connectionAtomRuntime);
