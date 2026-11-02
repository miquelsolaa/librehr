import { Hono } from "hono";
import type { Sql } from "postgres";
import { type AuthUser, createProblemDetails } from "@librehr/contracts";
import { generateIcsCalendar } from "@librehr/core";
import { withTenant, HolidayRepository, LeaveRepository } from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";

export function createCalendarRoutes(sql: Sql) {
  const router = new Hono();
  const holidayRepo = new HolidayRepository();
  const leaveRepo = new LeaveRepository();

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
