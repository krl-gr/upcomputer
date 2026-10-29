import { productSurface } from "../product/productFlags";

/**
 * Whether a thread's details card shows wherever it fits until the user
 * closes it, as upstream's does. Under the `threadDetailsCard` surface it is
 * closed until the user opens it, so the store remembers the open threads.
 */
export function threadDetailsCardOpenByDefault(): boolean {
  return productSurface("threadDetailsCard") !== "upcomputer";
}
