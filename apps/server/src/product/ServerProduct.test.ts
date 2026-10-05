import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { UPCOMPUTER_PRODUCT_FLAGS, UPSTREAM_PRODUCT_FLAGS } from "@t3tools/shared/productFlags";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import {
  ServerProduct,
  ServerProductCompositionError,
  composeExperimentalServerFeatures,
  eraseExperimentalServerLayer,
  productFeatureLayer,
  productMcpToolsLayer,
  whenProductFeature,
  withProductDefaultInstances,
  withProductProviderDrivers,
} from "./ServerProduct.ts";

class FeatureNotes extends Context.Service<
  FeatureNotes,
  { readonly read: Effect.Effect<string> }
>()("t3/product/ServerProduct.test/FeatureNotes") {}

const OWNER = "upcomputer.test";

/** Reads a row its own migration wrote, so it only builds after the migrations ran. */
const featureNotesLayer = Layer.effect(
  FeatureNotes,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly text: string }>`SELECT text FROM test_feature_notes`;
    return { read: Effect.succeed(rows.map((row) => row.text).join(",")) };
  }),
);

const feature = {
  id: OWNER,
  version: 1,
  migrations: [
    {
      ownerId: OWNER,
      namespace: OWNER,
      migrations: [
        {
          version: 1,
          name: "CreateNotes",
          run: Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`CREATE TABLE test_feature_notes (text TEXT NOT NULL)`;
            yield* sql`INSERT INTO test_feature_notes (text) VALUES ('migrated')`;
          }),
        },
      ],
    },
  ],
  layers: [
    {
      id: "notes",
      ownerId: OWNER,
      version: 1,
      layer: eraseExperimentalServerLayer(featureNotesLayer),
    },
  ],
  mcpTools: [
    {
      id: "notes-tools",
      ownerId: OWNER,
      version: 1,
      layer: eraseExperimentalServerLayer(
        Layer.effectDiscard(
          Effect.gen(function* () {
            const server = yield* McpServer.McpServer;
            const notes = yield* FeatureNotes;
            yield* server.addTool({
              tool: new McpSchema.Tool({
                name: "notes_read",
                description: "Reads the notes.",
                inputSchema: { type: "object", properties: {} },
              }),
              annotations: Context.empty(),
              handle: () =>
                notes.read.pipe(
                  Effect.map(
                    (text) => new McpSchema.CallToolResult({ content: [{ type: "text", text }] }),
                  ),
                ),
            });
          }),
        ),
      ),
    },
  ],
} as const;

describe("server product composition", () => {
  it("rejects contributions owned by another feature and duplicate features", () => {
    expect(() =>
      composeExperimentalServerFeatures([
        { id: OWNER, version: 1, layers: [{ ...feature.layers[0], ownerId: "upcomputer.other" }] },
      ]),
    ).toThrow(ServerProductCompositionError);
    expect(() =>
      composeExperimentalServerFeatures([
        { id: OWNER, version: 1 },
        { id: OWNER, version: 2 },
      ]),
    ).toThrow(ServerProductCompositionError);
  });

  it("adds product provider drivers after the built-in ones, never in their place", () => {
    const driver = { ...BUILT_IN_DRIVERS[0]!, driverKind: "test-driver" } as never;
    const product = composeExperimentalServerFeatures([
      {
        id: OWNER,
        version: 1,
        providerDrivers: [{ id: "test", ownerId: OWNER, version: 1, driver }],
      },
    ]);
    expect(withProductProviderDrivers(BUILT_IN_DRIVERS, product)).toEqual([
      ...BUILT_IN_DRIVERS,
      driver,
    ]);
    const shadowing = composeExperimentalServerFeatures([
      {
        id: OWNER,
        version: 1,
        providerDrivers: [
          { id: "codex", ownerId: OWNER, version: 1, driver: BUILT_IN_DRIVERS[0]! },
        ],
      },
    ]);
    expect(() => withProductProviderDrivers(BUILT_IN_DRIVERS, shadowing)).toThrow(
      ServerProductCompositionError,
    );
  });

  it("gives a product driver its default instance unless settings define one", () => {
    const driver = { ...BUILT_IN_DRIVERS[0]!, driverKind: "test-driver" } as never;
    const product = composeExperimentalServerFeatures([
      {
        id: OWNER,
        version: 1,
        providerDrivers: [{ id: "test", ownerId: OWNER, version: 1, driver }],
      },
    ]);
    const codex = { driver: BUILT_IN_DRIVERS[0]!.driverKind };
    expect(withProductDefaultInstances({ codex } as never, product)).toEqual({
      codex,
      "test-driver": { driver: "test-driver" },
    });
    const explicit = { driver: "test-driver", enabled: false };
    expect(withProductDefaultInstances({ "test-driver": explicit } as never, product)).toEqual({
      "test-driver": explicit,
    });
  });

  it.effect("runs feature migrations before feature layers and serves feature MCP tools", () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      assert.deepEqual(
        server.tools.map(({ tool }) => tool.name),
        ["notes_read"],
      );
      // Feature services are erased at the product boundary but present at runtime.
      const notes = yield* Effect.serviceOption(FeatureNotes);
      assert.equal(notes._tag === "Some" ? yield* notes.value.read : undefined, "migrated");
      const sql = yield* SqlClient.SqlClient;
      const history = yield* sql<{ readonly name: string }>`
        SELECT name FROM feature_migration_history WHERE namespace = ${OWNER}
      `;
      assert.deepEqual(
        history.map((row) => row.name),
        ["CreateNotes"],
      );
    }).pipe(
      Effect.provide(
        // The hooks core reads, with the product provided the way the CLI provides it.
        productMcpToolsLayer.pipe(
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provideMerge(productFeatureLayer),
          Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
          Layer.provide(Layer.succeed(ServerProduct, composeExperimentalServerFeatures([feature]))),
        ),
      ),
    ),
  );

  it("keeps upstream's flags unless the product sets its own", () => {
    expect(composeExperimentalServerFeatures([]).flags).toEqual(UPSTREAM_PRODUCT_FLAGS);
    expect(
      composeExperimentalServerFeatures([], { flags: UPCOMPUTER_PRODUCT_FLAGS }).flags,
    ).toEqual(UPCOMPUTER_PRODUCT_FLAGS);
  });

  it.effect("builds a flagged layer only when the product shows that feature", () =>
    Effect.gen(function* () {
      const started = yield* Ref.make<ReadonlyArray<string>>([]);
      const job = (name: string) =>
        Layer.effectDiscard(Ref.update(started, (names) => [...names, name]));
      const startJobs = (product?: ReturnType<typeof composeExperimentalServerFeatures>) =>
        Layer.build(
          Layer.mergeAll(
            whenProductFeature("pullRequests", job("pull-request-sync")),
            whenProductFeature("threadSettlement", job("settlement")),
          ).pipe(product ? Layer.provide(Layer.succeed(ServerProduct, product)) : (layer) => layer),
        ).pipe(Effect.scoped);

      // Core without a product: upstream behaviour, every job starts.
      yield* startJobs();
      expect(yield* Ref.getAndSet(started, [])).toEqual(["pull-request-sync", "settlement"]);

      yield* startJobs(composeExperimentalServerFeatures([], { flags: UPCOMPUTER_PRODUCT_FLAGS }));
      expect(yield* Ref.get(started)).toEqual([]);
    }),
  );
});
