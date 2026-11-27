import { describe, expect, it } from "vitest";
import { cachedZoneResolver } from "../src/zone-resolver.js";

describe("cachedZoneResolver (issue #38)", () => {
  const counting = () => {
    const calls: (string | null | undefined)[] = [];
    const zones = cachedZoneResolver(async (locationId) => {
      calls.push(locationId);
      return locationId === "canary" ? "Atlantic/Canary" : "Europe/Madrid";
    });
    return { zones, calls };
  };

  it("loads each location's zone once", async () => {
    const { zones, calls } = counting();
    expect(await zones("canary")).toBe("Atlantic/Canary");
    expect(await zones("canary")).toBe("Atlantic/Canary");
    expect(await zones("madrid")).toBe("Europe/Madrid");
    expect(calls).toEqual(["canary", "madrid"]);
  });

  it("treats null and undefined as the organization's zone", async () => {
    const { zones, calls } = counting();
    expect(await zones(null)).toBe("Europe/Madrid");
    expect(await zones(undefined)).toBe("Europe/Madrid");
    expect(await zones()).toBe("Europe/Madrid");
    expect(calls).toEqual([null]);
  });

  it("keeps separate caches per resolver", async () => {
    const first = counting();
    const second = counting();
    await first.zones("canary");
    await second.zones("canary");
    expect(first.calls).toEqual(["canary"]);
    expect(second.calls).toEqual(["canary"]);
  });
});
