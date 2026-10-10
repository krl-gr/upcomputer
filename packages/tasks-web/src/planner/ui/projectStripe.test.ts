import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";

import { deriveProjectIdentity } from "../../../../../apps/web/src/projectIdentity.ts";
import type { ProjectFaviconProject } from "../../../../../apps/web/src/components/ProjectFavicon.tsx";
import type { PlannerProject } from "./ProjectChip.tsx";
import { plannerProjectColor, projectStripeClassName } from "./projectStripe.ts";

const project = (
  name: string,
  projectIcon: ProjectFaviconProject["projectIcon"] = null,
  inbox = false,
): PlannerProject => ({
  id: name,
  name,
  inbox,
  favicon: {
    environmentId: "env" as ProjectFaviconProject["environmentId"],
    workspaceRoot: `/work/${name}`,
    title: name,
    faviconPath: null,
    projectIcon,
  },
});

test("a project's stripe takes its badge color: the icon's color, else the monogram's", () => {
  NodeAssert.equal(
    plannerProjectColor(project("Site", { kind: "monogram", text: "ST", color: "rose" })),
    "rose",
  );
  NodeAssert.equal(
    plannerProjectColor(project("Site", { kind: "lucide", name: "rocket", color: "teal" })),
    "teal",
  );
  const derived = deriveProjectIdentity("UpComputer").color;
  NodeAssert.equal(plannerProjectColor(project("UpComputer")), derived);
  NodeAssert.equal(
    plannerProjectColor(project("UpComputer", { kind: "emoji", emoji: "🚀" })),
    derived,
  );
  NodeAssert.match(
    projectStripeClassName(project("Site", { kind: "monogram", text: "ST", color: "rose" })),
    /\btext-rose-600\b/,
  );
});

test("a card without a project, or in the Inbox, gets the neutral stripe", () => {
  NodeAssert.equal(plannerProjectColor(null), null);
  NodeAssert.equal(projectStripeClassName(null), "bg-muted-foreground/60");
  NodeAssert.equal(projectStripeClassName(project("Inbox", null, true)), "bg-muted-foreground/60");
});
