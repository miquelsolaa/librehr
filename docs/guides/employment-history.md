# Employment history API (EMP-003)

`GET /v1/employees/{id}/employment-history` returns the employee's periods,
most recent first. Employees may read their own history; managers may read
their direct reports; administrators may read within their organization.

`POST /v1/employees/{id}/employment-history` allows an administrator to append
a period containing `jobTitle`, `employmentType`, `startDate` and an optional
inclusive `endDate` (all dates use `YYYY-MM-DD`). Invalid dates return 400 and
overlapping periods return 409. Each successful creation records an audit
entry without the title or other personal data. Tenant and role restrictions
apply to both operations.

The employee profile displays the history and lets administrators add a
non-overlapping period. An existing open-ended period cannot be superseded
through this endpoint. The
schema does not yet record historical department, manager or location, so
those fields are not included. Employment history is not a completed EMP-003
workflow until those gaps are addressed.
