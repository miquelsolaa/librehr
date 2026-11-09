import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createInspectionExport,
  inspectionExportLabels,
  sanitizeCsvValue,
  type InspectionExportInput,
} from "../src/index.js";
import {
  baseInput,
  day,
  parseCsv,
  session,
  sha256,
} from "./support/inspection-fixtures.js";

const METADATA_LINES = 8;

function signatureOf(csv: string, hash: string) {
  const signature = `# sha256=${hash}\r\n`;
  expect(csv.endsWith(signature)).toBe(true);
  return csv.slice(0, -signature.length);
}

function sessionsOf(input: InspectionExportInput): string[] {
  return createInspectionExport(input).rows.map((row) => row.sessions);
}

describe("createInspectionExport (TIM-006)", () => {
  it("signs the CSV body with SHA-256 in the final line", () => {
    const result = createInspectionExport(baseInput());
    const body = signatureOf(result.csv, result.contentHash);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(body)).toBe(result.contentHash);
    // `head -n -1 file.csv | sha256sum`: everything up to the last line.
    const headBody = result.csv.slice(
      0,
      result.csv.lastIndexOf("\n", result.csv.length - 2) + 1,
    );
    expect(headBody).toBe(body);
    expect(result.csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("uses CRLF line endings only", () => {
    const { csv } = createInspectionExport(baseInput());
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("is deterministic", () => {
    expect(createInspectionExport(baseInput())).toEqual(
      createInspectionExport(baseInput()),
    );
  });

  it("changes the hash when any cell or metadata value changes", () => {
    const base = createInspectionExport(baseInput()).contentHash;
    const employee = baseInput().employees[0]!;
    const firstDay = employee.days![0]!;
    const variants: InspectionExportInput[] = [
      baseInput({ exportId: "7d3c1f2e-0000-4000-8000-000000000002" }),
      baseInput({ organizationName: "Acme Serveis SLU" }),
      baseInput({ generatedAt: "2026-12-01T09:16:00Z" }),
      baseInput({ generatedBy: { name: "Ana Ruiz", role: "auditor" } }),
      baseInput({ periodEnd: "2026-11-04" }),
      baseInput({ scope: "organization" }),
      baseInput({ employees: [{ ...employee, name: "Marta García" }] }),
      baseInput({ employees: [{ ...employee, correctedDates: [] }] }),
      baseInput({ employees: [{ ...employee, chainStatus: "tampered" }] }),
      baseInput({
        employees: [
          {
            ...employee,
            days: [
              {
                ...firstDay,
                totalWorkedMinutes: firstDay.totalWorkedMinutes + 1,
              },
              ...employee.days!.slice(1),
            ],
          },
        ],
      }),
    ];
    for (const variant of variants) {
      expect(createInspectionExport(variant).contentHash).not.toBe(base);
    }
  });

  it("writes metadata, header and one row per employee per day", () => {
    const result = createInspectionExport(baseInput());
    const records = parseCsv(result.csv);
    expect(records).toHaveLength(METADATA_LINES + 1 + 2 + 1);
    expect(records[0]).toEqual(["# Documento: Registro de jornada"]);
    expect(result.csv).toContain("# Organización: Acme Serveis SL\r\n");
    expect(result.csv).toContain("# Periodo: 2026-11-02 – 2026-11-03\r\n");
    expect(result.csv).toContain(
      "# Fecha de generación: 2026-12-01T09:15:00Z (2026-12-01 10:15)\r\n",
    );
    expect(result.csv).toContain("# Generado por: Ana Ruiz (admin)\r\n");
    expect(records[METADATA_LINES]).toEqual(result.columns);
    expect(records[METADATA_LINES + 1]).toEqual([
      "Marta Garcia",
      "2026-11-02",
      "09:00-13:00 | 14:00-17:30",
      "0",
      "450",
      "480",
      "-30",
      "No",
      "No",
      "Verificada",
    ]);
    // Open session: start only, flagged as an anomaly; corrected day flagged.
    expect(records[METADATA_LINES + 2]).toEqual([
      "Marta Garcia",
      "2026-11-03",
      "09:00-",
      "0",
      "0",
      "480",
      "-480",
      "Sí",
      "Sí",
      "Verificada",
    ]);
  });

  it("shows local times on the Europe/Madrid DST change days", () => {
    const sessions = sessionsOf(
      baseInput({
        periodStart: "2026-03-29",
        periodEnd: "2026-10-25",
        employees: [
          {
            employeeId: "e1",
            name: "Marta Garcia",
            correctedDates: [],
            days: [
              day("2026-03-29", [
                session("2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z"),
                session("2026-03-29T07:00:00Z", "2026-03-29T15:00:00Z"),
              ]),
              day("2026-10-25", [
                session("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"),
                session("2026-10-25T07:00:00Z", "2026-10-25T15:00:00Z"),
              ]),
            ],
          },
        ],
      }),
    );
    // Spring forward: 02:00 CET jumps to 03:00 CEST.
    expect(sessions[0]).toBe("01:30-03:30 | 09:00-17:00");
    // Fall back: 03:00 CEST returns to 02:00 CET, so 02:30 happens twice.
    expect(sessions[1]).toBe("02:30-02:30 | 08:00-16:00");
  });

  it("shows local times across a year boundary", () => {
    const sessions = sessionsOf(
      baseInput({
        periodStart: "2026-12-31",
        periodEnd: "2027-01-01",
        employees: [
          {
            employeeId: "e1",
            name: "Marta Garcia",
            correctedDates: [],
            days: [
              day("2026-12-31", [
                session("2026-12-31T08:00:00Z", "2026-12-31T16:00:00Z"),
              ]),
              day("2027-01-01", [
                session("2026-12-31T23:30:00Z", "2027-01-01T01:00:00Z"),
              ]),
            ],
          },
        ],
      }),
    );
    expect(sessions).toEqual(["09:00-17:00", "00:30-02:00"]);
  });

  it("lists an employee without a schedule on a single flagged row", () => {
    const input = baseInput({
      scope: "organization",
      employees: [
        ...baseInput().employees,
        { employeeId: "e2", name: "Pau Vidal", days: null, correctedDates: [] },
      ],
    });
    const result = createInspectionExport(input);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toMatchObject({
      employeeId: "e2",
      date: null,
      scheduleNotConfigured: true,
    });
    expect(result.csv).toContain(
      "\r\nPau Vidal,,Horario no configurado,,,,,,,\r\n",
    );
    expect(result.csv).toContain("# Ámbito: Organización\r\n");
  });

  it.each([
    ["ca", "Persona treballadora,Data,Entrades i sortides", "# Organització: "],
    ["es", "Persona trabajadora,Fecha,Entradas y salidas", "# Organización: "],
    ["en", "Employee,Date,Clock in and out", "# Organization: "],
  ] as const)(
    "localizes headers and metadata in %s",
    (locale, header, meta) => {
      const result = createInspectionExport(baseInput({ locale }));
      expect(result.csv).toContain(`\r\n${header},`);
      expect(result.csv).toContain(meta);
      expect(result.csv).toContain(inspectionExportLabels(locale).yes);
    },
  );

  it("keeps a metadata line with a comma in one quoted cell", () => {
    const result = createInspectionExport(
      baseInput({ organizationName: 'Acme,=HYPERLINK("x")\nSL' }),
    );
    const records = parseCsv(result.csv);
    expect(records[1]).toEqual(['# Organización: Acme,=HYPERLINK("x") SL']);
    expect(sha256(signatureOf(result.csv, result.contentHash))).toBe(
      result.contentHash,
    );
  });

  it("round-trips arbitrary employee names and the hash verifies", () => {
    const nameChars = fc.constantFrom(
      ..."ab ,\"'\n\r\t=+-@#·çñàé😀".split(/(?:)/u),
    );
    const name = fc.oneof(fc.string(), fc.stringOf(nameChars));
    fc.assert(
      fc.property(fc.array(name, { minLength: 1, maxLength: 4 }), (names) => {
        const result = createInspectionExport(
          baseInput({
            scope: "organization",
            employees: names.map((n, i) => ({
              employeeId: `e${i}`,
              name: n,
              days: [day("2026-11-02", [])],
              correctedDates: [],
            })),
          }),
        );
        const body = signatureOf(result.csv, result.contentHash);
        expect(sha256(body)).toBe(result.contentHash);
        const records = parseCsv(result.csv);
        expect(records).toHaveLength(METADATA_LINES + 1 + names.length + 1);
        names.forEach((n, i) => {
          const record = records[METADATA_LINES + 1 + i];
          expect(record?.[0]).toBe(sanitizeCsvValue(n));
          expect(record).toHaveLength(result.columns.length);
        });
      }),
    );
  });
});
