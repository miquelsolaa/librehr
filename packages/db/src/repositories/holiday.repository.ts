import type { TenantTx } from "../with-tenant.js";

export interface HolidayCalendarRow {
  id: string;
  organizationId: string;
  locationId: string;
  year: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HolidayRow {
  id: string;
  organizationId: string;
  calendarId: string;
  date: string;
  name: string;
  scope: string; // national, regional, local, company
  createdAt: Date;
  updatedAt: Date;
}

export class HolidayRepository {
  async ensureCalendarForLocation(
    tx: TenantTx,
    locationId: string,
    year: number,
  ): Promise<string> {
    const existing = await tx<HolidayCalendarRow[]>`
      SELECT id, organization_id as "organizationId", location_id as "locationId",
             year, created_at as "createdAt", updated_at as "updatedAt"
      FROM holiday_calendars
      WHERE location_id = ${locationId} AND year = ${year}
      LIMIT 1
    `;

    if (existing[0]) {
      return existing[0].id;
    }

    const inserted = await tx<HolidayCalendarRow[]>`
      INSERT INTO holiday_calendars (location_id, year)
      VALUES (${locationId}, ${year})
      RETURNING id, organization_id as "organizationId", location_id as "locationId",
                year, created_at as "createdAt", updated_at as "updatedAt"
    `;

    return inserted[0]!.id;
  }

  async getHolidaysForLocation(
    tx: TenantTx,
    locationId: string,
    year: number,
  ): Promise<HolidayRow[]> {
    return tx<HolidayRow[]>`
      SELECT h.id, h.organization_id as "organizationId", h.calendar_id as "calendarId",
             h.date::text as "date", h.name, h.scope,
             h.created_at as "createdAt", h.updated_at as "updatedAt"
      FROM holidays h
      JOIN holiday_calendars c ON c.id = h.calendar_id
      WHERE c.location_id = ${locationId} AND c.year = ${year}
      ORDER BY h.date ASC
    `;
  }

  async createHoliday(
    tx: TenantTx,
    data: {
      calendarId: string;
      date: string;
      name: string;
      scope?: string | undefined;
    },
  ): Promise<HolidayRow> {
    const rows = await tx<HolidayRow[]>`
      INSERT INTO holidays (calendar_id, date, name, scope)
      VALUES (
        ${data.calendarId},
        ${data.date},
        ${data.name},
        ${data.scope ?? "national"}
      )
      RETURNING id, organization_id as "organizationId", calendar_id as "calendarId",
                date::text as "date", name, scope,
                created_at as "createdAt", updated_at as "updatedAt"
    `;
    return rows[0]!;
  }
}
