import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";

type HttpRouteMethod = Parameters<typeof HttpRouter.add>[0];
type HttpRoutePath = Parameters<typeof HttpRouter.add>[1];
type HttpRouteHandler = Parameters<typeof HttpRouter.add>[2];

export interface HttpRouteContribution {
  readonly id: string;
  readonly ownerId: string;
  readonly version: number;
  readonly method: HttpRouteMethod;
  readonly path: HttpRoutePath;
  readonly handler: HttpRouteHandler;
}

export type AnyHttpRouteContribution = HttpRouteContribution;

export class HttpRouteContributionError extends Error {
  override readonly name = "HttpRouteContributionError";
  readonly code:
    | "duplicate-id"
    | "duplicate-route"
    | "invalid-id"
    | "invalid-version"
    | "path-outside-owner-namespace";

  constructor(
    code:
      | "duplicate-id"
      | "duplicate-route"
      | "invalid-id"
      | "invalid-version"
      | "path-outside-owner-namespace",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new HttpRouteContributionError(
      "invalid-version",
      `HTTP contribution version '${String(version)}' must be a positive safe integer.`,
    );
  }
}

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function assertContributionId(value: string, label: string): void {
  if (!CONTRIBUTION_ID_PATTERN.test(value)) {
    throw new HttpRouteContributionError(
      "invalid-id",
      `${label} '${value}' must be a stable lowercase identifier.`,
    );
  }
}

function assertRoutePath(ownerId: string, path: HttpRoutePath): void {
  const prefix = `/api/extensions/${ownerId}/`;
  if (!path.startsWith(prefix) || path.length === prefix.length) {
    throw new HttpRouteContributionError(
      "path-outside-owner-namespace",
      `HTTP route '${path}' must be inside '${prefix}'.`,
    );
  }
}

/**
 * Describes an HTTP route owned by a build-time server feature.
 *
 * The route keeps its Effect requirements intact, so contributed handlers can
 * consume the same services as core handlers. The product composer remains
 * responsible for providing those services exactly once.
 *
 * @experimental The build-time extension API is still being validated by the
 * first-party feature extraction.
 */
export function defineHttpRouteContribution(
  contribution: HttpRouteContribution,
): HttpRouteContribution {
  assertContributionId(contribution.ownerId, "Owner id");
  assertContributionId(contribution.id, "HTTP contribution id");
  assertVersion(contribution.version);
  assertRoutePath(contribution.ownerId, contribution.path);
  return contribution;
}

/**
 * Validates and composes contributed routes into the application's one HTTP
 * router. Duplicate route identities and duplicate method/path pairs fail
 * before the router starts accepting requests.
 */
export function httpRouteContributionsLayer<
  const Contributions extends ReadonlyArray<AnyHttpRouteContribution>,
>(contributions: Contributions) {
  const ids = new Set<string>();
  const routes = new Set<string>();

  const ordered = [...contributions].sort((left, right) => {
    const ownerOrder = left.ownerId.localeCompare(right.ownerId);
    return ownerOrder !== 0 ? ownerOrder : left.id.localeCompare(right.id);
  });

  for (const contribution of ordered) {
    assertContributionId(contribution.ownerId, "Owner id");
    assertContributionId(contribution.id, "HTTP contribution id");
    assertVersion(contribution.version);
    assertRoutePath(contribution.ownerId, contribution.path);

    const contributionKey = `${contribution.ownerId}:${contribution.id}`;
    if (ids.has(contributionKey)) {
      throw new HttpRouteContributionError(
        "duplicate-id",
        `HTTP contribution '${contributionKey}' is registered more than once.`,
      );
    }
    ids.add(contributionKey);

    const routeKey = `${contribution.method} ${contribution.path}`;
    if (routes.has(routeKey)) {
      throw new HttpRouteContributionError(
        "duplicate-route",
        `HTTP route '${routeKey}' is contributed more than once.`,
      );
    }
    routes.add(routeKey);
  }

  const layers = ordered.map(({ method, path, handler }) => HttpRouter.add(method, path, handler));
  if (layers.length === 0) return Layer.empty;
  const [first, ...rest] = layers;
  return Layer.mergeAll(first!, ...rest);
}
