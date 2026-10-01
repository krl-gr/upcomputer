import { describe, expect, it } from "vite-plus/test";

import { WEB_PRODUCT_COMPOSITION } from "./defaultProductEntry";
import { resolveKnownInteractionMode } from "./interactionModePresentation";
import { createExperimentalWebProductComposition } from "./WebComposition";

describe("resolveKnownInteractionMode", () => {
  it("shows and sends a removed mode as Default", () => {
    expect(resolveKnownInteractionMode("orchestrator", WEB_PRODUCT_COMPOSITION)).toBe("default");
  });

  it("keeps core modes and modes a bundled feature defines", () => {
    const composition = createExperimentalWebProductComposition({
      features: [
        {
          id: "review.web",
          ownerId: "upcomputer.review",
          version: 1,
          interactionModes: [{ id: "review", label: "Review", description: "Review changes." }],
        },
      ],
    });

    expect(resolveKnownInteractionMode("plan", WEB_PRODUCT_COMPOSITION)).toBe("plan");
    expect(resolveKnownInteractionMode("ask", WEB_PRODUCT_COMPOSITION)).toBe("ask");
    expect(resolveKnownInteractionMode("review", composition)).toBe("review");
  });
});
