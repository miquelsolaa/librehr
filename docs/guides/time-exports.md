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

- **Employee scope.** Days follow the employee's location time zone (else the
  organization's). If no schedule covers every day of the period, the export
  fails with `409 SCHEDULE_NOT_CONFIGURED`.
- **Organization scope.** Every employee employed at some point in the period
  (not terminated before it, with an employment overlapping it or no
  employment record at all), ordered by last name. The whole document uses the
  organization's time zone, so every row and the header agree. An employee
  without a configured schedule appears on one row marked "schedule not
  configured" instead of failing the export.

## What the document contains

- A header with the organization, period, scope, time zone, generation time
  (UTC and local), who generated it (name and role) and the export id.
- One row per employee and day: clock-in and clock-out times, break minutes,
  worked minutes, expected minutes, the difference, an anomaly flag (a session
  left open), a "corrected" flag (a correction changed or replaced a record of
  that day) and the integrity status of the employee's time records
  (verified, tampered, legacy or no data).

Every response carries `X-Export-Id` and `X-Content-SHA256` headers and is
sent with `Cache-Control: no-store`. CSV and PDF are downloads named
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
