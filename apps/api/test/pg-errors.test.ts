import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "../src/errors/index.js";
import {
  mapPgErrors,
  pgErrorCode,
  PG_EXCLUSION_VIOLATION,
} from "../src/lib/pg-errors.js";

describe("pg error mapping", () => {
  const overlap = () => new ConflictError({ code: "MEMBERSHIP_OVERLAP" });

  it("turns a listed SQLSTATE into the typed error (race on 23P01)", async () => {
    const work = () =>
      Promise.reject(Object.assign(new Error("x"), { code: "23P01" }));
    await expect(
      mapPgErrors(work, { [PG_EXCLUSION_VIOLATION]: overlap }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_OVERLAP" });
  });

  it("rethrows other errors untouched, including AppErrors", async () => {
    const other = Object.assign(new Error("x"), { code: "23505" });
    await expect(
      mapPgErrors(() => Promise.reject(other), { "23P01": overlap }),
    ).rejects.toBe(other);
    const notFound = new NotFoundError({ code: "23P01" });
    expect(pgErrorCode(notFound)).toBeUndefined();
    await expect(
      mapPgErrors(() => Promise.reject(notFound), { "23P01": overlap }),
    ).rejects.toBe(notFound);
  });
});
