import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RelayDb from "../db.ts";
import { relayMobileDevices } from "../persistence/schema.ts";
import * as Devices from "./Devices.ts";

const registration: RelayDeviceRegistrationRequest = {
  deviceId: "device-1" as RelayDeviceRegistrationRequest["deviceId"],
  label: "Julius's iPhone",
  platform: "ios",
  iosMajorVersion: 18,
  appVersion: "1.0.0" as RelayDeviceRegistrationRequest["appVersion"],
  bundleId: "com.t3tools.t3code.preview" as RelayDeviceRegistrationRequest["bundleId"],
  apsEnvironment: "production",
  pushToken: "apns-device-token" as RelayDeviceRegistrationRequest["pushToken"],
  pushToStartToken: "push-to-start-token" as RelayDeviceRegistrationRequest["pushToStartToken"],
  preferences: {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

const passThroughTransaction = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;

interface StoredDevice {
  readonly userId: string;
  readonly deviceId: string;
  readonly platform: string;
  pushToken: string | null;
  webPushP256dh: string | null;
  webPushAuth: string | null;
}

/**
 * The devices table in memory, for the statements `register` issues. Records
 * whether each statement ran inside `withTransaction`.
 */
function memoryDevicesDb(
  rows: Array<StoredDevice>,
  options: {
    /** The ownership check reads a snapshot taken before a concurrent commit. */
    readonly selectSnapshot?: ReadonlyArray<StoredDevice>;
  } = {},
) {
  const dialect = new PgDialect();
  const statements: Array<{ readonly statement: string; readonly inTransaction: boolean }> = [];
  let inTransaction = false;
  const record = (statement: string) => statements.push({ statement, inTransaction });
  const tokenCondition = (condition: SQL) => {
    const query = dialect.sqlToQuery(condition);
    const token = query.params[0];
    const nativeOnly = query.sql.includes('"platform" <>');
    const ownedOnly = query.sql.includes('"user_id" =');
    const [, userId, auth, p256dh] = query.params;
    return (row: StoredDevice) =>
      row.pushToken === token &&
      (!nativeOnly || row.platform !== "web") &&
      (!ownedOnly ||
        row.userId === userId ||
        (row.webPushAuth === auth && row.webPushP256dh === p256dh));
  };
  const db = {
    $client: {
      withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          inTransaction = true;
          return effect;
        }).pipe(Effect.ensuring(Effect.sync(() => (inTransaction = false)))),
    },
    select: () => ({
      from: () => ({
        where: (condition: SQL) => ({
          for: (strength: string) => {
            record(`select for ${strength}`);
            return Effect.succeed(
              (options.selectSnapshot ?? rows).filter(tokenCondition(condition)).map((row) => ({
                userId: row.userId,
                platform: row.platform,
                p256dh: row.webPushP256dh,
                auth: row.webPushAuth,
              })),
            );
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: SQL) =>
          Effect.sync(() => {
            record("update");
            if (!("pushToken" in values)) return;
            for (const row of rows.filter(tokenCondition(condition))) row.pushToken = null;
          }),
      }),
    }),
    insert: () => ({
      values: (values: StoredDevice) => ({
        onConflictDoUpdate: () =>
          Effect.sync(() => {
            record("upsert");
            const existing = rows.find(
              (row) => row.userId === values.userId && row.deviceId === values.deviceId,
            );
            const next = {
              userId: values.userId,
              deviceId: values.deviceId,
              platform: values.platform,
              pushToken: values.pushToken,
              webPushP256dh: values.webPushP256dh,
              webPushAuth: values.webPushAuth,
            };
            if (existing) Object.assign(existing, next);
            else rows.push(next);
          }),
      }),
    }),
  } as unknown as RelayDb.RelayDb["Service"];
  return { db, statements };
}

const endpoint = "https://web.push.apple.com/QGuQyavXutnMHqjVhN7m5r3X7DHpQ6BtRXFYMeVA";
const browserKeys = { p256dh: "browser-public-key", auth: "browser-auth-secret" };

function webRegistration(
  deviceId: string,
  keys: { readonly p256dh: string; readonly auth: string },
): RelayDeviceRegistrationRequest {
  return {
    deviceId: deviceId as RelayDeviceRegistrationRequest["deviceId"],
    label: "Safari on iPhone",
    platform: "web",
    webPush: { endpoint, ...keys } as RelayDeviceRegistrationRequest["webPush"],
    preferences: { ...registration.preferences, liveActivitiesEnabled: false },
  };
}

function storedBrowser(userId: string, deviceId: string): StoredDevice {
  return {
    userId,
    deviceId,
    platform: "web",
    pushToken: endpoint,
    webPushP256dh: browserKeys.p256dh,
    webPushAuth: browserKeys.auth,
  };
}

const provideDb = (db: RelayDb.RelayDb["Service"]) =>
  Effect.provide(Devices.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, db))));

describe("Devices web push endpoint ownership", () => {
  it.effect.each([
    { case: "a wrong auth secret", keys: { ...browserKeys, auth: "attacker-auth-secret" } },
    { case: "a wrong public key", keys: { ...browserKeys, p256dh: "attacker-public-key" } },
  ])("refuses another account's endpoint with $case and leaves it untouched", ({ keys }) => {
    const rows = [storedBrowser("user-a", "browser-a")];
    const { db, statements } = memoryDevicesDb(rows);
    return Effect.gen(function* () {
      const devices = yield* Devices.Devices;
      const error = yield* devices
        .register({ userId: "user-b", registration: webRegistration("browser-b", keys) })
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(Devices.WebPushSubscriptionConflictError);
      expect(error).toMatchObject({ userId: "user-b", deviceId: "browser-b" });
      expect(rows).toEqual([storedBrowser("user-a", "browser-a")]);
      expect(statements).toEqual([{ statement: "select for update", inTransaction: true }]);
    }).pipe(provideDb(db));
  });

  it.effect(
    "keeps a concurrently moved endpoint when the ownership check saw a stale snapshot",
    () => {
      // The endpoint moved from user-a to user-c after this request's check read
      // its snapshot, so the check found no holder to compare keys with.
      const rows = [
        { ...storedBrowser("user-a", "browser-a"), pushToken: null },
        storedBrowser("user-c", "browser-c"),
      ];
      const { db } = memoryDevicesDb(rows, { selectSnapshot: [] });
      return Effect.gen(function* () {
        const devices = yield* Devices.Devices;
        yield* devices
          .register({
            userId: "user-b",
            registration: webRegistration("browser-b", {
              ...browserKeys,
              auth: "attacker-auth-secret",
            }),
          })
          .pipe(Effect.ignore);

        expect(rows.find((row) => row.userId === "user-c")).toEqual(
          storedBrowser("user-c", "browser-c"),
        );
      }).pipe(provideDb(db));
    },
  );

  it.effect("moves the endpoint when the same browser signs in to another account", () => {
    const rows = [storedBrowser("user-a", "browser-a")];
    const { db, statements } = memoryDevicesDb(rows);
    return Effect.gen(function* () {
      const devices = yield* Devices.Devices;
      yield* devices.register({
        userId: "user-b",
        registration: webRegistration("browser-b", browserKeys),
      });

      expect(rows).toEqual([
        { ...storedBrowser("user-a", "browser-a"), pushToken: null },
        storedBrowser("user-b", "browser-b"),
      ]);
      expect(statements.every((statement) => statement.inTransaction)).toBe(true);
    }).pipe(provideDb(db));
  });

  it.effect("updates the account's own row when its browser registers again", () => {
    const rows = [storedBrowser("user-a", "browser-a")];
    const { db } = memoryDevicesDb(rows);
    const rotated = { p256dh: "rotated-public-key", auth: "rotated-auth-secret" };
    return Effect.gen(function* () {
      const devices = yield* Devices.Devices;
      yield* devices.register({
        userId: "user-a",
        registration: webRegistration("browser-a", rotated),
      });

      expect(rows).toEqual([
        {
          ...storedBrowser("user-a", "browser-a"),
          webPushP256dh: rotated.p256dh,
          webPushAuth: rotated.auth,
        },
      ]);
    }).pipe(provideDb(db));
  });

  it.effect("keeps a native registration from taking over a web endpoint", () => {
    const rows = [storedBrowser("user-a", "browser-a")];
    const { db } = memoryDevicesDb(rows);
    return Effect.gen(function* () {
      const devices = yield* Devices.Devices;
      yield* devices.register({
        userId: "user-b",
        registration: {
          ...registration,
          pushToken: endpoint as RelayDeviceRegistrationRequest["pushToken"],
        },
      });

      // The unique push_token index then rejects the insert in Postgres; the
      // web row itself is never cleared.
      expect(rows[0]).toEqual(storedBrowser("user-a", "browser-a"));
    }).pipe(provideDb(db));
  });
});

describe("Devices", () => {
  it.effect(
    "claims APNs tokens from other native devices before upserting the current user device",
    () => {
      const calls: Array<string> = [];
      const updateSets: Array<Record<string, unknown>> = [];
      const updateConditions: Array<SQL> = [];
      const insertedValues: Array<Record<string, unknown>> = [];
      const dialect = new PgDialect();

      const fakeDb = {
        $client: { withTransaction: passThroughTransaction },
        update: (table: unknown) => {
          expect(table).toBe(relayMobileDevices);
          calls.push("update");
          return {
            set: (values: Record<string, unknown>) => {
              updateSets.push(values);
              calls.push("update.set");
              return {
                where: (condition: SQL) => {
                  expect(condition).toBeDefined();
                  updateConditions.push(condition);
                  calls.push("update.where");
                  return Effect.void;
                },
              };
            },
          };
        },
        insert: (table: unknown) => {
          expect(table).toBe(relayMobileDevices);
          calls.push("insert");
          return {
            values: (values: Record<string, unknown>) => {
              insertedValues.push(values);
              calls.push("insert.values");
              return {
                onConflictDoUpdate: (config: unknown) => {
                  expect(config).toBeDefined();
                  calls.push("insert.onConflictDoUpdate");
                  return Effect.void;
                },
              };
            },
          };
        },
      } as unknown as RelayDb.RelayDb["Service"];

      return Effect.gen(function* () {
        const devices = yield* Devices.Devices;
        yield* devices.register({ userId: "user-2", registration });

        expect(calls).toEqual([
          "update",
          "update.set",
          "update.where",
          "update",
          "update.set",
          "update.where",
          "insert",
          "insert.values",
          "insert.onConflictDoUpdate",
        ]);
        expect(updateSets).toEqual([
          expect.objectContaining({ pushToken: null }),
          expect.objectContaining({ pushToStartToken: null }),
        ]);
        expect(updateConditions.map((condition) => dialect.sqlToQuery(condition))).toEqual([
          {
            sql:
              '(("relay_mobile_devices"."push_token" = $1) and ' +
              '("relay_mobile_devices"."platform" <> $2))',
            params: ["apns-device-token", "web"],
          },
          {
            sql: '"relay_mobile_devices"."push_to_start_token" = $1',
            params: ["push-to-start-token"],
          },
        ]);
        expect(insertedValues).toEqual([
          expect.objectContaining({
            userId: "user-2",
            deviceId: "device-1",
            bundleId: "com.t3tools.t3code.preview",
            apsEnvironment: "production",
            pushToken: "apns-device-token",
            pushToStartToken: "push-to-start-token",
          }),
        ]);
      }).pipe(
        Effect.provide(Devices.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
      );
    },
  );

  it.effect("removes a gone web subscription only while the device still holds it", () => {
    const deleteConditions: Array<SQL> = [];
    const dialect = new PgDialect();
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayMobileDevices);
        return {
          where: (condition: SQL) => {
            deleteConditions.push(condition);
            return Effect.void;
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const devices = yield* Devices.Devices;
      yield* devices.removeWebPushSubscription({
        userId: "user-2",
        deviceId: "browser",
        endpoint: "https://web.push.apple.com/abc",
      });
      expect(deleteConditions.map((condition) => dialect.sqlToQuery(condition))).toEqual([
        {
          sql:
            '(("relay_mobile_devices"."user_id" = $1) and ' +
            '("relay_mobile_devices"."device_id" = $2) and ' +
            '("relay_mobile_devices"."platform" = $3) and ' +
            '("relay_mobile_devices"."push_token" = $4))',
          params: ["user-2", "browser", "web", "https://web.push.apple.com/abc"],
        },
      ]);
    }).pipe(
      Effect.provide(Devices.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb)))),
    );
  });
});
