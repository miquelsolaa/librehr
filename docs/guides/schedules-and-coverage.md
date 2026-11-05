# Schedule and coverage configuration

The time and leave calculations require explicit organization settings. Existing departments are deliberately left unconfigured by migration `0016_department_coverage.sql`; there is no automatic minimum-presence percentage.

1. Sign in as an administrator and open **Settings → Departments**. For each department, enter a whole-number minimum presence percentage and select **Save coverage**. Enter `0` only if the organization intentionally applies no minimum presence threshold. Leave requests for a department without a configured threshold return `COVERAGE_NOT_CONFIGURED`. With a nonzero threshold, half-day requests or existing half-day absences return `COVERAGE_UNVERIFIABLE`: the current data model does not record which half of the day is affected, so it cannot verify overlapping coverage reliably.
2. Open **Settings → Work schedules**. Find the employee, enter an effective date, minimum daily rest and a rule for every day of the week. Enter `0` hours and `0` break minutes explicitly for days with no scheduled work. Save the assignment.
3. Timesheets and inspection exports return `SCHEDULE_NOT_CONFIGURED` when a requested day has no applicable schedule rule; they do not assume an eight-hour day.

Schedule assignments are effective-dated. This first version rejects a new assignment that overlaps an existing assignment, rather than rewriting history. Editing or closing an existing open-ended assignment is not yet available in this screen. The administrator must choose working-time settings appropriate to the organization and applicable agreements; the form does not determine legal compliance.

Coverage and schedule changes are recorded in the audit log. Authorization is enforced by the API. Work-time reporting still has known timezone and period-boundary limitations and should not be treated as a complete payroll export; see the redesign plan for outstanding report work.

# Manager access to time records

Managers can view and export time records for their direct reports (TIM-004).
The reporting relationship is resolved within the active organization; access to
other employees remains subject to the caller's role and scope. This affects
authorization for time records and exports.
