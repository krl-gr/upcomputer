import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TraitsSelectOptionLabel } from "./TraitsPicker";

describe("TraitsSelectOptionLabel", () => {
  it("shows the option description under its label", () => {
    const markup = renderToStaticMarkup(
      <TraitsSelectOptionLabel
        option={{
          id: "ultracode",
          label: "Ultracode",
          description: "xhigh effort plus multi-agent workflow orchestration",
        }}
      />,
    );
    expect(markup).toContain("Ultracode");
    expect(markup).toContain("xhigh effort plus multi-agent workflow orchestration");
  });

  it("renders only the label and default badge without a description", () => {
    const markup = renderToStaticMarkup(
      <TraitsSelectOptionLabel option={{ id: "high", label: "High", isDefault: true }} />,
    );
    expect(markup).toContain("High");
    expect(markup).toContain("Default");
    expect(markup).not.toContain("text-pretty");
  });
});
