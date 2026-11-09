import type { Context } from "hono";
import { todayInZone } from "@librehr/core";
import { OrganizationRepository, type TenantTx } from "@librehr/db";
import { SystemClockAdapter } from "../adapters/clock-system.js";
import type { ClockPort } from "../ports/clock.js";

const orgRepo = new OrganizationRepository();
const systemClock: ClockPort = new SystemClockAdapter();
const CACHE_KEY = "businessTimeZones";

/**
 * The time zone business dates follow for this request (ORG-001/ADM-003):
 * the location's when one is given, else the organization's. Loaded at most
 * once per request and location.
 */
export async function resolveBusinessTimeZone(
  c: Context,
  tx: TenantTx,
  locationId?: string | null | undefined,
): Promise<string> {
  const get = c.get as (key: string) => unknown;
  let cache = get(CACHE_KEY) as Map<string, string> | undefined;
  if (!cache) {
    cache = new Map();
    (c.set as (key: string, value: unknown) => void)(CACHE_KEY, cache);
  }
  const key = locationId ?? "";
  const cached = cache.get(key);
  if (cached) return cached;
  const zone = await orgRepo.getBusinessTimeZone(tx, locationId);
  cache.set(key, zone);
  return zone;
}

/**
 * Today's ISO date in the organization's (or location's) time zone. Never
 * the UTC date: at 23:30 UTC on 31 December it is 1 January in Madrid.
 *
 * @example
 * const today = await businessToday(c, tx, employee.locationId);
 */
export async function businessToday(
  c: Context,
  tx: TenantTx,
  locationId?: string | null | undefined,
  clock: ClockPort = systemClock,
): Promise<string> {
  return todayInZone(await resolveBusinessTimeZone(c, tx, locationId), clock);
}
