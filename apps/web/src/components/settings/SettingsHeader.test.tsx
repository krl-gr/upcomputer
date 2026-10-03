import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SIDEBAR_LABEL_TEXT_CLASS } from "../sidebar/sidebarTextStyles";
import {
  SETTINGS_HEADER_TITLE_CLASS,
  SettingsHeaderBackButton,
  SettingsHeaderTitle,
} from "./SettingsHeader";

function renderBackButton(isSectionList: boolean) {
  return renderToStaticMarkup(
    <SettingsHeaderBackButton isSectionList={isSectionList} onClick={() => {}} />,
  );
}

describe("SettingsHeaderBackButton", () => {
  it("shows the same arrow, without text, on the section list and in a section", () => {
    for (const isSectionList of [true, false]) {
      const html = renderBackButton(isSectionList);

      expect(html).toContain("lucide-arrow-left");
      expect(html).not.toContain("lucide-chevron-left");
      expect(html.replace(/<[^>]*>/g, "")).toBe("");
    }
  });

  it("labels where the arrow goes", () => {
    expect(renderBackButton(true)).toContain('aria-label="Back to chat"');
    expect(renderBackButton(false)).toContain('aria-label="Back to settings"');
  });

  it("stays clickable inside the desktop drag region", () => {
    expect(renderBackButton(false)).toContain("[-webkit-app-region:no-drag]");
  });
});

describe("SettingsHeaderTitle", () => {
  it("renders an h1 in the row label text style", () => {
    const html = renderToStaticMarkup(<SettingsHeaderTitle>General</SettingsHeaderTitle>);

    expect(SETTINGS_HEADER_TITLE_CLASS).toContain(SIDEBAR_LABEL_TEXT_CLASS);
    expect(html).toBe(`<h1 class="${SETTINGS_HEADER_TITLE_CLASS}">General</h1>`);
  });
});
