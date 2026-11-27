import { OrganizationRepository, type TenantTx } from "@librehr/db";

/**
 * Business time zone (ORG-001/ADM-003) of a location, or of the organization
 * when no location is given.
 */
export type ZoneResolver = (
  locationId?: string | null | undefined,
) => Promise<string>;

const orgRepo = new OrganizationRepository();

/**
 * Wraps `lookup` so each location's zone is loaded at most once.
 *
 * @example
 * const zones = cachedZoneResolver((id) => repo.getBusinessTimeZone(tx, id));
 * await zones(null); // organization zone, loaded once
 */
export function cachedZoneResolver(lookup: ZoneResolver): ZoneResolver {
  const cache = new Map<string, string>();
  return async (locationId) => {
    const key = locationId ?? "";
    const cached = cache.get(key);
    if (cached) return cached;
    const zone = await lookup(locationId);
    cache.set(key, zone);
    return zone;
  };
}

/**
 * Zone resolver reading the tenant transaction `tx`, cached for its lifetime.
 * Create one per transaction: zones may change between transactions.
 *
 * @example
 * const zones = createZoneResolver(tx);
 * const zone = await zones(employee.locationId);
 */
export function createZoneResolver(tx: TenantTx): ZoneResolver {
  return cachedZoneResolver((locationId) =>
    orgRepo.getBusinessTimeZone(tx, locationId),
  );
}
