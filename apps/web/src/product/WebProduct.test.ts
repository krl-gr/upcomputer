import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  RpcScopeAuthorization,
  ThreadId,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcTest from "effect/unstable/rpc/RpcTest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { chatHeaderAccessoryElements, threadRowAccessoryElement } from "./ProductSlots";
import { UPCOMPUTER_PRODUCT_FLAGS, UPSTREAM_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import {
  defineExperimentalWebFeature,
  WebFeatureInvariantError,
  type ExperimentalWebThreadAccessoryProps,
  type ExperimentalWebThreadRowAccessoryProps,
} from "./WebFeature";
import {
  composeExperimentalWebFeatures,
  findExperimentalWebRoute,
  findExperimentalWebSettingsPage,
  isExperimentalWebNavigationActive,
} from "./WebProduct";

const NotesCountRpc = Rpc.make("test.notes.count", { success: Schema.Number });
const NotesGroup = RpcGroup.make(NotesCountRpc);

const NotesPage = () => null;
const NotesBadge = () => "3";
/** Shows a count on threads that have notes, the row's timestamp otherwise. */
const NotesRowAccessory = (props: ExperimentalWebThreadRowAccessoryProps) =>
  props.threadId === "thread-with-notes" ? "2 notes" : props.fallback;
const NotesHeaderAccessory = (_props: ExperimentalWebThreadAccessoryProps) => "notes";
const PinsRowAccessory = (props: ExperimentalWebThreadRowAccessoryProps) => props.fallback;

/** One feature in every slot. */
const notesFeature = defineExperimentalWebFeature({
  id: "test.notes",
  version: 1,
  routes: [{ id: "notes", path: "/notes", load: async () => ({ default: NotesPage }) }],
  navigation: [{ id: "notes", label: "Notes", path: "/notes", accessory: NotesBadge }],
  settings: [
    {
      id: "notes-settings",
      label: "Notes",
      path: "/settings/notes",
      load: async () => ({ default: NotesPage }),
    },
  ],
  threadRowAccessory: NotesRowAccessory,
  chatHeaderAccessory: NotesHeaderAccessory,
  rpcGroups: [NotesGroup],
});

const pinsFeature = defineExperimentalWebFeature({
  id: "test.pins",
  version: 1,
  navigation: [{ id: "pins", label: "Pins", path: "/pins", order: -1 }],
  threadRowAccessory: PinsRowAccessory,
});

const environmentId = EnvironmentId.make("environment-1");
type CoreTag = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/** Renders a component element chain as plain function calls. */
function renderNode(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  return renderNode((element.type as (props: unknown) => ReactNode)(element.props));
}

describe("web product composition", () => {
  it("places a feature in every slot", async () => {
    const product = composeExperimentalWebFeatures([notesFeature, pinsFeature]);

    expect(product.navigation.map((item) => item.id)).toEqual(["pins", "notes"]);
    const notes = product.navigation[1]!;
    expect(notes.accessory).toBe(NotesBadge);
    expect(isExperimentalWebNavigationActive(notes, "/notes/123")).toBe(true);
    expect(isExperimentalWebNavigationActive(notes, "/notebook")).toBe(false);

    const route = findExperimentalWebRoute(product, "/notes");
    expect((await route!.load()).default).toBe(NotesPage);
    expect(findExperimentalWebRoute(product, "/elsewhere")).toBeUndefined();
    expect(findExperimentalWebSettingsPage(product, "/settings/notes")?.label).toBe("Notes");

    const row = (threadId: string) =>
      renderNode(
        threadRowAccessoryElement(product, {
          environmentId,
          threadId: ThreadId.make(threadId),
          fallback: "5m",
        }),
      );
    expect(row("thread-with-notes")).toBe("2 notes");
    expect(row("thread-without-notes")).toBe("5m");

    const header = chatHeaderAccessoryElements(product, {
      environmentId,
      threadId: ThreadId.make("thread-with-notes"),
    });
    expect(header.map(renderNode)).toEqual(["notes"]);
  });

  it("keeps core's behavior when no feature fills a slot", () => {
    const product = composeExperimentalWebFeatures([]);
    expect(product.rpcGroup).toBe(WsRpcGroup);
    expect(product.flags).toEqual(UPSTREAM_PRODUCT_FLAGS);
    expect(composeExperimentalWebFeatures([], { flags: UPCOMPUTER_PRODUCT_FLAGS }).flags).toEqual(
      UPCOMPUTER_PRODUCT_FLAGS,
    );
    expect(
      threadRowAccessoryElement(product, {
        environmentId,
        threadId: ThreadId.make("thread"),
        fallback: "5m",
      }),
    ).toBe("5m");
  });

  it("rejects features that collide with core or each other", () => {
    expect(() =>
      defineExperimentalWebFeature({
        id: "test.bad",
        version: 1,
        routes: [{ id: "usage", path: "/usage", load: async () => ({ default: NotesPage }) }],
      }),
    ).toThrow(WebFeatureInvariantError);
    expect(() => composeExperimentalWebFeatures([notesFeature, notesFeature])).toThrow(
      WebFeatureInvariantError,
    );
    const ProbeRpc = Rpc.make(WS_METHODS.serverProbe, { success: Schema.Struct({}) });
    expect(() =>
      composeExperimentalWebFeatures([
        { id: "test.shadow", version: 1, rpcGroups: [RpcGroup.make(ProbeRpc)] },
      ]),
    ).toThrow(WebFeatureInvariantError);
  });

  it("builds the session client for core and feature RPC methods", async () => {
    const product = composeExperimentalWebFeatures([notesFeature]);
    // Only the methods this test serves; the rest of core is omitted.
    const served = product.rpcGroup.omit(
      ...[...WsRpcGroup.requests.keys()].filter(
        (tag): tag is Exclude<CoreTag, typeof WS_METHODS.serverProbe> =>
          tag !== WS_METHODS.serverProbe,
      ),
    );
    const call = (featureAllowed: boolean) =>
      Effect.gen(function* () {
        // The typed view of the feature methods the merged group carries at runtime.
        const client = (yield* RpcTest.makeClient(served)) as RpcClient.RpcClient<
          | RpcGroup.Rpcs<typeof served>
          | Rpc.AddMiddleware<typeof NotesCountRpc, typeof RpcScopeAuthorization>
        >;
        return {
          probe: yield* client[WS_METHODS.serverProbe]({}),
          notes: yield* client["test.notes.count"]().pipe(Effect.result),
        };
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            served.toLayerHandler(WS_METHODS.serverProbe, () => Effect.succeed({})),
            NotesGroup.toLayerHandler("test.notes.count", () => Effect.succeed(3)),
            // As the server does for a session without the method's scope.
            Layer.succeed(RpcScopeAuthorization)((effect, { rpc }) =>
              rpc._tag === "test.notes.count" && !featureAllowed
                ? Effect.fail(
                    new EnvironmentAuthorizationError({
                      message: "missing scope",
                      requiredScope: AuthOrchestrationOperateScope,
                    }),
                  )
                : effect,
            ),
          ),
        ),
        Effect.runPromise,
      );

    const allowed = await call(true);
    expect(allowed.probe).toEqual({});
    expect(allowed.notes).toMatchObject({ _tag: "Success", success: 3 });
    const denied = await call(false);
    expect(denied.notes).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "EnvironmentAuthorizationError" },
    });
  });
});
