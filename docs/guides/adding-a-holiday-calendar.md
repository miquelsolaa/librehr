# Adding a Holiday Calendar

OpenHR supports location-specific and regional public holiday calendars.

## 1. Domain Types (`packages/core/src/calendar/holidays.ts`)

A holiday is represented by:

```typescript
export interface PublicHoliday {
  date: string; // ISO 8601 YYYY-MM-DD
  name: string;
  scope: "national" | "regional" | "local";
}
```

## 2. Adding Calendar Data

1. Add new regional or national entries in `packages/db/seeds/holidays-es.ts` or create a new seed file `holidays-<country>.ts`.
2. Seed data must reference official state gazettes (e.g. Boletín Oficial del Estado - BOE, Diari Oficial de la Generalitat de Catalunya - DOGC).
3. Do not assume midnights or perform UTC arithmetic; calendar days are stored strictly as `date` strings in the location's timezone.

## 3. Testing

Add unit tests in `packages/core/test/calendar.test.ts` verifying working-day computations for the new calendar dates.
