export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  scope: "national" | "regional" | "local";
}

export function isHoliday(
  dateStr: string,
  holidays: ReadonlySet<string>,
): boolean {
  return holidays.has(dateStr);
}
