import { createCoreProductManifest } from "@upcomputer/shared/product";

import packageJson from "../package.json" with { type: "json" };

export const PRODUCT_MANIFEST = createCoreProductManifest(packageJson.version);
