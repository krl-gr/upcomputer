import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot(),
}));

import { useIsMobile } from "./useMediaQuery";

function Probe() {
  return <span>{useIsMobile() ? "compact" : "desktop"}</span>;
}

afterEach(() => vi.unstubAllGlobals());

describe("shared compact breakpoint", () => {
  it.each([400, 639, 640, 767, 768, 1200])("uses the sm boundary at %d CSS pixels", (width) => {
    const matchMedia = vi.fn((query: string) => {
      expect(query).toBe("(max-width: 639px)");
      return { matches: width <= 639 };
    });
    vi.stubGlobal("window", { matchMedia });
    expect(renderToStaticMarkup(<Probe />)).toContain(width < 640 ? "compact" : "desktop");
    expect(matchMedia).toHaveBeenCalled();
  });
});
