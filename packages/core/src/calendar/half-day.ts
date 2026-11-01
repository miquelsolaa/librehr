export type HalfDayType = "morning" | "afternoon";

export interface HalfDaySelection {
  isHalfDay: boolean;
  type?: HalfDayType;
}
