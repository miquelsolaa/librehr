import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateHolidayRequestSchema,
  SeedStatutoryHolidaysRequestSchema,
} from "@librehr/contracts";
import { generateIcsCalendar, resolveLocationHolidays } from "@librehr/core";
import {
  withTenant,
  HolidayRepository,
  LeaveRepository,
  LocationRepository,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createCalendarRoutes(sql: Sql) {
  const router = new Hono();
  const holidayRepo = new HolidayRepository();
  const leaveRepo = new LeaveRepository();
  const locationRepo = new LocationRepository();

  // 1. GET /calendar/holidays - List holidays for a location and year
  router.get("/calendar/holidays", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const locationId = c.req.query("locationId");
    const yearStr = c.req.query("year");
    const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();

    if (!locationId) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "locationId query parameter is required",
        code: "MISSING_LOCATION_ID",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const holidays = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await holidayRepo.ensureCalendarForLocation(tx, locationId, year);
        return holidayRepo.getHolidaysForLocation(tx, locationId, year);
      },
    );

    return c.json(
      holidays.map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        scope: h.scope,
      })),
    );
  });

  // 1b. POST /calendar/holidays - Add a holiday to a location's calendar (LEA-003)
  router.post("/calendar/holidays", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators and managers can configure holidays",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parsed = CreateHolidayRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid holiday data",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { locationId, date, name, scope } = parsed.data;
    const year = parsed.data.year ?? parseInt(date.slice(0, 4), 10);

    const holiday = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const calendarId = await holidayRepo.ensureCalendarForLocation(
          tx,
          locationId,
          year,
        );
        return holidayRepo.createHoliday(tx, {
          calendarId,
          date,
          name,
          scope,
        });
      },
    );

    return c.json(
      {
        id: holiday.id,
        date: holiday.date,
        name: holiday.name,
        scope: holiday.scope,
      },
      201,
    );
  });

  // 1c. DELETE /calendar/holidays/:id - Remove a holiday (LEA-003)
  router.delete("/calendar/holidays/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators and managers can delete holidays",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const id = c.req.param("id");
    const success = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return holidayRepo.deleteHoliday(tx, id);
      },
    );

    if (!success) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Holiday not found",
        code: "HOLIDAY_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json({ success: true });
  });

  // 1d. POST /calendar/seed-statutory - Populate official 3-tier Spanish holidays (LEA-003)
  router.post("/calendar/seed-statutory", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    if (user.role !== "admin" && user.role !== "manager") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Only administrators and managers can seed statutory holidays",
        code: "FORBIDDEN",
      });
      return c.json(problem, 403, {
        "Content-Type": "application/problem+json",
      });
    }

    const body = await c.req.json();
    const parsed = SeedStatutoryHolidaysRequestSchema.safeParse(body);
    if (!parsed.success) {
      const problem = createProblemDetails({
        status: 400,
        title: "Validation Error",
        detail: parsed.error.issues[0]?.message ?? "Invalid request",
        code: "VALIDATION_ERROR",
      });
      return c.json(problem, 400, {
        "Content-Type": "application/problem+json",
      });
    }

    const { locationId, year } = parsed.data;

    const holidays = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const loc = await locationRepo.findById(tx, locationId);
        const region = parsed.data.region ?? loc?.region ?? "CT";
        const city = parsed.data.city ?? loc?.city ?? "Barcelona";

        const statutory = resolveLocationHolidays({
          year,
          region,
          city,
        });

        return holidayRepo.seedStatutoryHolidays(
          tx,
          locationId,
          year,
          statutory.map((h) => ({
            date: h.date,
            name: h.name,
            scope: h.scope,
          })),
        );
      },
    );

    return c.json(
      holidays.map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        scope: h.scope,
      })),
      201,
    );
  });

  // 2. GET /calendar/team-absences - Team calendar with GDPR Art. 9 privacy masking
  router.get("/calendar/team-absences", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const startDate =
      c.req.query("startDate") ?? new Date().toISOString().slice(0, 10);
    const endDate =
      c.req.query("endDate") ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const departmentId = c.req.query("departmentId");

    const absences = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return leaveRepo.getTeamAbsences(tx, {
          startDate,
          endDate,
          departmentId,
        });
      },
    );

    // GDPR Art. 9 Compliance: Non-privileged users (role: employee) only see generic "Away"
    // Managers & HR Admins see actual statutory leave type name and code.
    const isPrivileged = user.role === "admin" || user.role === "manager";

    return c.json(
      absences.map((a) => ({
        requestId: a.requestId,
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        departmentId: a.departmentId,
        departmentName: a.departmentName,
        startDate: a.startDate,
        endDate: a.endDate,
        halfDayStart: a.halfDayStart,
        halfDayEnd: a.halfDayEnd,
        leaveTypeCode: isPrivileged ? a.leaveTypeCode : "away",
        leaveTypeName: isPrivileged ? a.leaveTypeName : "Away",
        status: a.status,
      })),
    );
  });

  // 3. GET /calendar/feed.ics - iCalendar (RFC 5545) subscription feed (LEA-009)
  router.get("/calendar/feed.ics", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const icsContent = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const absences = await leaveRepo.getTeamAbsences(tx, {
          startDate,
          endDate,
        });

        const isPrivileged = user.role === "admin" || user.role === "manager";
        const events = absences.map((a) => ({
          uid: `absence-${a.requestId}`,
          summary: `${a.employeeName} - ${isPrivileged ? a.leaveTypeName : "Away"}`,
          startDateStr: a.startDate,
          endDateStr: a.endDate,
        }));

        return generateIcsCalendar("LibreHR Calendar Feed", events);
      },
    );

    return new Response(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="calendar_feed.ics"',
      },
    });
  });

  return router;
}
