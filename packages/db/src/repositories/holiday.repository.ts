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

  async getHolidayById(
    tx: TenantTx,
    holidayId: string,
  ): Promise<HolidayRow | null> {
    const rows = await tx<HolidayRow[]>`
      SELECT id, organization_id as "organizationId", calendar_id as "calendarId",
             date::text as "date", name, scope,
             created_at as "createdAt", updated_at as "updatedAt"
      FROM holidays
      WHERE id = ${holidayId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async deleteHoliday(tx: TenantTx, holidayId: string): Promise<boolean> {
    const result = await tx`
      DELETE FROM holidays
      WHERE id = ${holidayId}
    `;
    return result.count > 0;
  }

  async seedStatutoryHolidays(
    tx: TenantTx,
    locationId: string,
    year: number,
    holidays: Array<{ date: string; name: string; scope: string }>,
  ): Promise<HolidayRow[]> {
    const calendarId = await this.ensureCalendarForLocation(
      tx,
      locationId,
      year,
    );

    // Delete existing holidays for that calendar to re-seed cleanly
    await tx`
      DELETE FROM holidays
      WHERE calendar_id = ${calendarId}
    `;

    const inserted: HolidayRow[] = [];
    for (const h of holidays) {
      const row = await this.createHoliday(tx, {
        calendarId,
        date: h.date,
        name: h.name,
        scope: h.scope,
      });
      inserted.push(row);
    }

    return inserted;
  }
}
