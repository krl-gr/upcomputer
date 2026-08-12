import { describe, expect, it } from "vite-plus/test";

import { cn } from "../lib/utils";
import {
  CONTEXT_BAR_BRANCH_TRIGGER_CLASS,
  CONTEXT_BAR_TEXT_CLASS,
  CONTEXT_BAR_TEXT_TRIGGER_CLASS,
} from "./BranchToolbar.styles";

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

  it("keeps workspace and branch triggers on the shared text contract", () => {
    expect(CONTEXT_BAR_TEXT_TRIGGER_CLASS).toContain(CONTEXT_BAR_TEXT_CLASS);
    expect(CONTEXT_BAR_BRANCH_TRIGGER_CLASS).toContain(CONTEXT_BAR_TEXT_CLASS);
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
