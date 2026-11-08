import type { TimeEvent, TimeEventType } from "./events.js";

/**
 * Select the latest recorded replacement for each event while retaining
 * independent manual events. Original events remain unchanged in storage.
 *
 * @example
 * resolveCorrections([]); // []
 */
export function resolveCorrections(events: readonly TimeEvent[]): TimeEvent[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  if (byId.size !== events.length) throw new Error("Duplicate time event id");
  const cache = new Map<string, { root: string; eventType: TimeEventType }>();
  const visiting = new Set<string>();

  function resolve(event: TimeEvent): {
    root: string;
    eventType: TimeEventType;
  } {
    const found = cache.get(event.id);
    if (found) return found;
    if (visiting.has(event.id)) throw new Error("Cyclic time correction");
    visiting.add(event.id);
    let result: { root: string; eventType: TimeEventType };
    if (event.refEventId) {
      const original = byId.get(event.refEventId);
      if (
        !original ||
        original.employeeId !== event.employeeId ||
        original.organizationId !== event.organizationId
      ) {
        throw new Error("Invalid time correction reference");
      }
      if (Date.parse(event.recordedAt) < Date.parse(original.recordedAt)) {
        throw new Error("Time correction predates its reference");
      }
      const parent = resolve(original);
      result = {
        root: parent.root,
        eventType:
          event.eventType === "correction" ? parent.eventType : event.eventType,
      };
    } else {
      if (event.eventType === "correction")
        throw new Error("Time correction requires a reference");
      result = { root: event.id, eventType: event.eventType };
    }
    visiting.delete(event.id);
    cache.set(event.id, result);
    return result;
  }

  const selected = new Map<string, TimeEvent>();
  for (const event of events) {
    const { root, eventType } = resolve(event);
    const previous = selected.get(root);
    if (
      !previous ||
      Date.parse(event.recordedAt) > Date.parse(previous.recordedAt) ||
      (Date.parse(event.recordedAt) === Date.parse(previous.recordedAt) &&
        event.id > previous.id)
    ) {
      selected.set(root, { ...event, eventType });
    }
  }
  return [...selected.values()];
}
