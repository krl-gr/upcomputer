import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { legacyEnvironmentName } from "./environmentNames.ts";

export { readUpcomputerEnvironment, normalizeUpcomputerEnvironment } from "./environmentNames.ts";

/** ConfigProvider fallback only applies to a missing name, never a parse error.
 * Supports injected providers as well as real environment variables. No global
 * environment mutation or configuration/credential logging is involved.
 */
export function withLegacyEnvironment<A>(config: Config.Config<A>): Config.Config<A> {
  return Config.make((provider) =>
    config.parse(
      ConfigProvider.make((path) =>
        provider
          .load(path)
          .pipe(
            Effect.flatMap((value) =>
              value !== undefined
                ? Effect.succeed(value)
                : provider.load(
                    path.map((segment) =>
                      typeof segment === "string" ? legacyEnvironmentName(segment) : segment,
                    ),
                  ),
            ),
          ),
      ),
    ),
  );
}
