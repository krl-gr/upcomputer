import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SkillInlineText } from "./SkillInlineText";

describe("SkillInlineText", () => {
  it("chips digit-leading skills without chipping monetary amounts", () => {
    const html = renderToStaticMarkup(
      <SkillInlineText
        text="Use $2spec with a $20k budget."
        skills={[
          { name: "2spec", displayName: "2Spec" },
          { name: "20k", displayName: "MoneySkill" },
        ]}
      />,
    );
    expect(html).toContain("2Spec");
    expect(html).not.toContain("MoneySkill");
    expect(html).toContain("$20k budget.");
  });
});
