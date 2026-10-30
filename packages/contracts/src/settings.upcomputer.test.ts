import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ClientSettingsPatch, ClientSettingsSchema } from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);

describe("ClientSettings compact composer", () => {
  it("compacts bot chats' composer by default and accepts opting out", () => {
    expect(decodeClientSettings({}).composerCompact).toBe(true);
    expect(decodeClientSettingsPatch({ composerCompact: false }).composerCompact).toBe(false);
  });
});
