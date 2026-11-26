import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRoleSeparatedDatabase,
  getTestDatabase,
  type RoleSeparatedDatabase,
  type TestDatabase,
} from "@librehr/testing";
import { runMigrations } from "@librehr/db/migrate";
import type { RateLimitStore } from "../src/lib/rate-limit-store.js";
import {
  isolatedRateLimitStore,
  memoryRateLimitStore,
} from "./support/rate-limit.js";

// Issue #35: the in-memory test double used by fake-sql tests must behave
// like the Postgres store. Every scenario runs against both, on a clock far
// in the future so no real-clock sweep touches the rows.
const T0 = Date.parse("2099-01-01T00:00:00Z");
const policy = { windowMs: 60_000, lockoutMs: 300_000 };

type Scenario = (
  store: RateLimitStore,
  setNow: (ms: number) => void,
) => Promise<void>;

const scenarios: Array<[string, Scenario]> = [
  [
    "counts a fixed window and restarts it at its end",
    async (store, setNow) => {
      expect(await store.hit("w", 60_000)).toEqual({
        count: 1,
        resetInMs: 60_000,
      });
      setNow(T0 + 59_999);
      expect(await store.hit("w", 60_000)).toEqual({ count: 2, resetInMs: 1 });
      setNow(T0 + 60_000);
      expect(await store.hit("w", 60_000)).toEqual({
        count: 1,
        resetInMs: 60_000,
      });
    },
  ],
  [
    "locks at the failure limit until the lockout ends",
    async (store, setNow) => {
      for (let i = 0; i < 3; i++) {
        await store.recordFailure([{ key: "f", limit: 3 }], policy);
      }
      expect(await store.lockedFor(["f"])).toBe(300_000);
      setNow(T0 + 299_999);
      expect(await store.lockedFor(["f"])).toBe(1);
      setNow(T0 + 300_000);
      expect(await store.lockedFor(["f"])).toBe(0);
    },
  ],
  [
    "counts a failure exactly windowMs later, forgets it 1 ms after",
    async (store, setNow) => {
      await store.recordFailure([{ key: "a", limit: 2 }], policy);
      setNow(T0 + 60_000);
      await store.recordFailure([{ key: "a", limit: 2 }], policy);
      expect(await store.lockedFor(["a"])).toBe(300_000);

      setNow(T0);
      await store.recordFailure([{ key: "b", limit: 2 }], policy);
      setNow(T0 + 60_001);
      await store.recordFailure([{ key: "b", limit: 2 }], policy);
      expect(await store.lockedFor(["b"])).toBe(0);
    },
  ],
  [
    "reserves `limit` attempts, refuses while locked, then allows again",
    async (store, setNow) => {
      const p = { ...policy, limit: 3 };
      const results = [];
      for (let i = 0; i < 4; i++)
        results.push(await store.reserveAttempt("r", p));
      expect(results).toEqual([
        { allowed: true },
        { allowed: true },
        { allowed: true },
        { allowed: false, lockedMs: 300_000 },
      ]);
      setNow(T0 + 300_000);
      expect(await store.reserveAttempt("r", p)).toEqual({ allowed: true });
    },
  ],
  [
    "clears failures and reservations on reset",
    async (store) => {
      const p = { ...policy, limit: 2 };
      await store.reserveAttempt("c", p);
      await store.reset("c");
      expect(await store.reserveAttempt("c", p)).toEqual({ allowed: true });
      expect(await store.reserveAttempt("c", p)).toEqual({ allowed: true });
      expect((await store.reserveAttempt("c", p)).allowed).toBe(false);
    },
  ],
  [
    "keeps a lockout longer than the window when a new window starts",
    async (store, setNow) => {
      await store.recordFailure([{ key: "l", limit: 1 }], policy);
      // The 60 s window is stale, the 5 min lock is not.
      setNow(T0 + 120_000);
      await store.recordFailure([{ key: "l", limit: 3 }], policy);
      expect(await store.lockedFor(["l"])).toBe(180_000);
      expect(await store.reserveAttempt("l", { ...policy, limit: 3 })).toEqual({
        allowed: false,
        lockedMs: 180_000,
      });
      setNow(T0 + 300_000);
      expect(await store.lockedFor(["l"])).toBe(0);
    },
  ],
  [
    "reports the latest lock among several keys",
    async (store, setNow) => {
      await store.recordFailure([{ key: "x", limit: 1 }], policy);
      setNow(T0 + 5_000);
      await store.recordFailure([{ key: "y", limit: 1 }], policy);
      expect(await store.lockedFor(["x", "y", "none"])).toBe(300_000);
      expect(await store.lockedFor(["none"])).toBe(0);
    },
  ],
];

describe("rate-limit store parity: memory double vs Postgres (issue #35)", () => {
  let base: TestDatabase;
  let db: RoleSeparatedDatabase;

  beforeAll(async () => {
    const database = await getTestDatabase();
    if (!database) throw new Error("Docker is required for rate-limit tests");
    base = database;
    db = await createRoleSeparatedDatabase(base);
    await runMigrations(db.ownerConnectionString);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (base) await base.close();
  });

  const factories: Array<[string, (now: () => number) => RateLimitStore]> = [
    ["memory", (now) => memoryRateLimitStore(now)],
    ["postgres", (now) => isolatedRateLimitStore(db.appSql, { now })],
  ];

  for (const [name, scenario] of scenarios) {
    for (const [kind, make] of factories) {
      it(`${kind}: ${name}`, async () => {
        let now = T0;
        await scenario(
          make(() => now),
          (ms) => {
            now = ms;
          },
        );
      });
    }
  }
});
