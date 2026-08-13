// @effect-diagnostics nodeBuiltinImport:off - This regression test inspects trigger markup.
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { cn } from "../lib/utils";
import {
  CONTEXT_BAR_BRANCH_TRIGGER_CLASS,
  CONTEXT_BAR_TEXT_CLASS,
  CONTEXT_BAR_TEXT_TRIGGER_CLASS,
} from "./BranchToolbar.styles";

const branchSelectorSource = NodeFS.readFileSync(
  new URL("./BranchToolbarBranchSelector.tsx", import.meta.url),
  "utf8",
);

const TYPOGRAPHY_CONTRACT = [
  "font-sans",
  "!text-sm",
  "sm:!text-sm",
  "!font-normal",
  "!leading-relaxed",
  "!tracking-normal",
] as const;

describe("composer context-bar typography", () => {
  it("defines one explicit typography contract for workspace and branch labels", () => {
    for (const utility of TYPOGRAPHY_CONTRACT) {
      expect(CONTEXT_BAR_TEXT_CLASS.split(" ")).toContain(utility);
    }
  });

  it("keeps workspace and branch triggers on the same color and text contract", () => {
    for (const utility of [
      ...TYPOGRAPHY_CONTRACT,
      "text-muted-foreground",
      "hover:!text-foreground",
      "dark:hover:!text-white/86",
    ]) {
      expect(CONTEXT_BAR_TEXT_TRIGGER_CLASS.split(" ")).toContain(utility);
      expect(CONTEXT_BAR_BRANCH_TRIGGER_CLASS.split(" ")).toContain(utility);
    }
  });

  it("lets the branch trigger use real flex space without a chevron or fixed label cap", () => {
    const resolvedTriggerClasses = cn("inline-flex shrink-0", CONTEXT_BAR_BRANCH_TRIGGER_CLASS);

    expect(branchSelectorSource).toContain('className="flex min-w-0 flex-1"');
    expect(resolvedTriggerClasses.split(" ")).toEqual(
      expect.arrayContaining(["w-full", "min-w-0", "flex-1", "shrink", "max-w-full"]),
    );
    expect(resolvedTriggerClasses.split(" ")).not.toContain("shrink-0");
    expect(branchSelectorSource).not.toContain("ChevronDownIcon");
    expect(branchSelectorSource).not.toMatch(/max-w-\[\d+px\]/);
  });

  it("overrides independent button typography without changing trigger geometry", () => {
    const branchTriggerClasses = cn(
      "h-7 gap-1 px-2 font-mono text-xs font-medium leading-none tracking-wide",
      CONTEXT_BAR_TEXT_CLASS,
    );

    for (const utility of TYPOGRAPHY_CONTRACT) {
      expect(branchTriggerClasses.split(" ")).toContain(utility);
    }
    expect(branchTriggerClasses).toContain("h-7");
    expect(branchTriggerClasses).toContain("gap-1");
    expect(branchTriggerClasses).toContain("px-2");
    expect(branchTriggerClasses).not.toContain("font-mono");
  });
});
