export interface GestoriaEmployeeSummary {
  taxId: string; // NIF / NIE
  socialSecurityNumber?: string | null | undefined;
  firstName: string;
  lastName: string;
  contractType: string;
  workedDays: number;
  vacationDays: number;
  sickLeaveDays: number;
  maternityPaternityDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
}

/**
 * Generates an RFC 4180 compliant CSV export formatted for Spanish gestorías/payroll providers (RPT-002).
 * Fields:
 * NIF/NIE, Num Afiliacion SS, Apellidos, Nombre, Tipo Contrato, Dias Trabajados, Dias Vacaciones, Dias IT/Baja Medica, Dias Maternidad/Paternidad, Dias No Retribuidos, Horas Extras
 */
export function generateGestoriaCsv(
  periodYearMonth: string, // YYYY-MM
  employees: GestoriaEmployeeSummary[],
): string {
  const headers = [
    "Periodo",
    "NIF_NIE",
    "Num_SS",
    "Apellidos",
    "Nombre",
    "Tipo_Contrato",
    "Dias_Trabajados",
    "Dias_Vacaciones",
    "Dias_IT_Enfermedad",
    "Dias_Maternidad_Paternidad",
    "Dias_No_Retribuidos",
    "Horas_Extras",
  ];

  const rows: string[] = [headers.join(",")];

  for (const emp of employees) {
    const sanitize = (val: string | number | null | undefined) => {
      const s = String(val ?? "").trim();
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const row = [
      sanitize(periodYearMonth),
      sanitize(emp.taxId),
      sanitize(emp.socialSecurityNumber ?? ""),
      sanitize(emp.lastName),
      sanitize(emp.firstName),
      sanitize(emp.contractType),
      sanitize(emp.workedDays),
      sanitize(emp.vacationDays),
      sanitize(emp.sickLeaveDays),
      sanitize(emp.maternityPaternityDays),
      sanitize(emp.unpaidLeaveDays),
      sanitize(emp.overtimeHours.toFixed(2)),
    ];

    rows.push(row.join(","));
  }

  return rows.join("\r\n") + "\r\n";
}
