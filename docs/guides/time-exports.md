# Working-time exports (TIM-006)

The working-time export is the daily record of working time that the Labour
and Social Security Inspectorate, workers and their representatives may ask
for (Estatuto de los Trabajadores art. 34.9). See `COMPLIANCE.md` §3 for the
legal background.

## Who can export what

| Role     | Own record | Direct reports | Any employee | Whole organization |
| -------- | ---------- | -------------- | ------------ | ------------------ |
| Employee | yes        | no             | no           | no                 |
| Manager  | yes        | yes            | no           | no                 |
| Auditor  | yes        | yes            | yes          | yes                |
| Admin    | yes        | yes            | yes          | yes                |

An employee outside your scope gives `403`; an unknown id gives `404`.

## Request

`GET /v1/time/export` with these query parameters:

| Parameter    | Values                                | Default                  |
| ------------ | ------------------------------------- | ------------------------ |
| `startDate`  | `YYYY-MM-DD`                          | required                 |
| `endDate`    | `YYYY-MM-DD`, on or after `startDate` | required                 |
| `format`     | `json`, `csv`, `pdf`                  | `json`                   |
| `scope`      | `employee`, `organization`            | `employee`               |
| `employeeId` | employee id (only with `employee`)    | your own employee record |
| `locale`     | `ca`, `es`, `en` (document language)  | `es`                     |

A period covers at most 366 days.

- **Time zones.** Each employee's days (local midnight to local midnight) and
  clock times are in that employee's time zone: their location's, else the
  organization's. This is the same in both scopes, so an employee's rows are
  identical in their own export and in the organization export. Every row
  names its zone in a "Time zone" column; the header shows the organization's
  zone and the generation time in it. For example, with a Europe/Madrid
  organization, an employee at an Atlantic/Canary location who clocks in at
  08:00 UTC in November reads `08:00`, a Madrid colleague `09:00`.
- **Employment days.** The last column, "Employed" ("Contractat",
  "Contratado"), says whether the day falls inside one of the employee's
  employment periods (their employment records; an employee without any is
  employed every day unless terminated, then until the termination date). A
  day outside them expects 0 minutes, so its difference equals the work
  recorded that day, which is still listed with its anomaly and corrected
  flags: a former or not-yet-hired employee never shows a fake absence. JSON
  responses also carry the flag per row in `rowsEmployed` (null on a
  "schedule not configured" row), and the preview badges those days "Not
  employed".
- **Employee scope.** If no schedule covers every day of the period on which
  the employee is employed, the export fails with
  `409 SCHEDULE_NOT_CONFIGURED`. An employee with no employed day in the
  period (for example a manager's former report) is exported with every day
  flagged instead. Without `employeeId`, a
  user who has no employee record gets `404`.
- **Organization scope.** Every employee with an employment record that
  overlaps the period (a re-hired employee is included whatever their old
  termination date says), with no employment record at all and not terminated
  before the period, or with a time record in the period (recorded work is
  always listed, even if HR data says otherwise). Ordered by last name. An
  employee without a configured schedule appears on one row marked "schedule
  not configured" instead of failing the export.
- **Size limit.** An organization export covers at most 50,000 employee-days
  (number of employees listed × days in the period; about 136 employees for a
  full year or 1,600 for a 31-day month). A larger request fails with
  `422 EXPORT_TOO_LARGE`: export shorter periods (for example month by month).
- **Rate limit.** Each user can request 10 exports per minute (per client
  address, behind `TRUST_PROXY` hops). Beyond that the API answers
  `429 RATE_LIMIT_EXCEEDED` with a `Retry-After` header.

## Employee picker

`GET /v1/time/export/employees?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` lists
whom the caller may export for that period, as `{ items: [{ id, name }] }`
sorted by name. The web export page fills its employee picker from it and
reloads it when the dates change.

| Role     | Listed                                                         |
| -------- | -------------------------------------------------------------- |
| Employee | themselves                                                     |
| Manager  | themselves and their direct reports                            |
| Auditor  | every employee an organization export of the period would list |
| Admin    | every employee an organization export of the period would list |

The list starts from the same employees as an organization export of the
period (see above) and keeps those inside the caller's `time.record.read`
scope. It needs `time.record.read` only, not `employee.read`, so an auditor
can pick one employee without seeing the employee directory. It returns ids
and display names only (no email, department or other directory fields).
Period rules are the export's: `400` for an invalid date, an end before the
start or more than 366 days; `401` without a session; `403` without
`time.record.read`.

- **Audit log (TIM-008).** A caller with organization-wide `time.record.read`
  but no `employee.read` (the auditor role) gets one
  `inspector.export_picker_access` entry per call, with the period and the
  number of employees listed (`periodStart`, `periodEnd`, `employeeCount`):
  no names or emails. Admin, manager and employee listings are not logged;
  their exports are (see below).
- **Rate limit.** 60 requests per minute per user and client address, counted
  apart from the export's 10. Beyond that the API answers
  `429 RATE_LIMIT_EXCEEDED` with a `Retry-After` header.
- **Web page.** While the list reloads after a date change, the employee
  select and the export buttons are disabled. If the new period no longer
  lists the selected employee, the choice resets to your own record and the
  page says so. If the list cannot be loaded, it is cleared and only your own
  record can be exported.

## What the document contains

- A header with the organization, period, scope, the organization's time
  zone, generation time (UTC and local), who generated it (name and role) and
  the export id.
- One row per employee and day: clock-in and clock-out times, break minutes,
  worked minutes, expected minutes, the difference, an anomaly flag (a session
  left open), a "corrected" flag (a correction changed or replaced a record of
  that day), the integrity status of the employee's time records
  (verified, tampered, legacy or no data), the time zone of the row and
  whether the employee was employed that day (see "Employment days" above).

The integrity status checks every stored record of the employee: each
record's keyed signature, the order and links of the chain, and the anchor
that names its newest record (so deleted, inserted, edited or truncated
records show as tampered). It cannot tell that records and anchor were both
rewound to an earlier state; the scheduled chain verification
(`audit.verify-chain`) detects that by comparing with its previous run.

The day before and the day after the period are read too, so a night shift
across the first or last midnight is counted on the right days. A shift longer
than that across a period edge is cut at the edge of what was read.

Every response carries `X-Export-Id` and `X-Content-SHA256` headers and is
sent with `Cache-Control: no-store`. Browsers on another origin may read these
and `Content-Disposition`. CSV and PDF are downloads named
`registro-jornada-<start>-<end>[-<employee id prefix>].<csv|pdf>`.

## Verifying a CSV

The last line of the CSV is `# sha256=<hash>`: the SHA-256 of every byte
before that line. The file starts with a byte-order mark (so spreadsheet
software reads the accents correctly) that is not part of the hash, so strip
its 3 bytes first:

```sh
tail -c +4 registro-jornada.csv | head -n -1 | sha256sum   # Linux
tail -c +4 registro-jornada.csv | sed '$d' | shasum -a 256 # macOS
```

The result must equal the hash on the last line, the `X-Content-SHA256`
header and the hash in the audit log. Editing the file in a spreadsheet and
saving it again changes the bytes, so verify the file as downloaded.

## PDFs and the audit log

A PDF is not hashed itself. Each page footer shows the export id and the CSV
content hash. Every successful export writes one `time.export` entry to the
audit log, with the export id, scope, format, language, period, number of
employees, content hash and, for one employee, their id. It holds no names or
emails. To check a PDF, find its export id in the audit log and compare the
hash.

The PDF uses the standard Helvetica fonts, which are not embedded, and Latin-1
text: Catalan and Spanish accents print correctly, characters outside Latin-1
print as `?`.
