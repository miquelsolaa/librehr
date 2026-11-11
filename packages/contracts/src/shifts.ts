import { z } from "zod";

export const ShiftTypeEnum = z.enum(["morning", "afternoon", "night", "rest"]);
export type ShiftType = z.infer<typeof ShiftTypeEnum>;

export const ShiftTemplateSchema = z.object({
  id: z.guid(),
  name: z.string().min(1),
  code: z.string().min(1).max(10),
  type: ShiftTypeEnum,
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  color: z.string(),
  breakMinutes: z.number().int().nonnegative(),
});
export type ShiftTemplate = z.infer<typeof ShiftTemplateSchema>;

export const CreateShiftTemplateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(10),
  type: ShiftTypeEnum.default("morning"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  color: z.string().default("#3b82f6"),
  breakMinutes: z.number().int().nonnegative().default(30),
});
export type CreateShiftTemplateRequest = z.infer<
  typeof CreateShiftTemplateRequestSchema
>;

export const ShiftPatternStepSchema = z.object({
  id: z.guid().optional(),
  stepOrder: z.number().int().nonnegative(),
  shiftTemplateId: z.guid().nullable().optional(),
  isRest: z.boolean(),
  shiftCode: z.string().optional(),
  shiftName: z.string().optional(),
});
export type ShiftPatternStep = z.infer<typeof ShiftPatternStepSchema>;

export const ShiftPatternSchema = z.object({
  id: z.guid(),
  name: z.string().min(1),
  cycleDays: z.number().int().positive(),
  description: z.string().nullable().optional(),
  steps: z.array(ShiftPatternStepSchema).optional(),
});
export type ShiftPattern = z.infer<typeof ShiftPatternSchema>;

export const CreateShiftPatternRequestSchema = z.object({
  name: z.string().min(1).max(100),
  cycleDays: z.number().int().positive(),
  description: z.string().optional(),
  steps: z.array(
    z.object({
      stepOrder: z.number().int().nonnegative(),
      shiftTemplateId: z.guid().nullable().optional(),
      isRest: z.boolean().default(false),
    }),
  ),
});
export type CreateShiftPatternRequest = z.infer<
  typeof CreateShiftPatternRequestSchema
>;

export const ShiftAssignmentSchema = z.object({
  id: z.guid(),
  employeeId: z.guid(),
  employeeName: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shiftTemplateId: z.guid().nullable().optional(),
  shiftCode: z.string().optional(),
  shiftName: z.string().optional(),
  shiftType: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  color: z.string().optional(),
  status: z.string(),
  notes: z.string().nullable().optional(),
});
export type ShiftAssignment = z.infer<typeof ShiftAssignmentSchema>;

export const AssignShiftsRequestSchema = z.object({
  assignments: z.array(
    z.object({
      employeeId: z.guid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      shiftTemplateId: z.guid().nullable().optional(),
      status: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
});
export type AssignShiftsRequest = z.infer<typeof AssignShiftsRequestSchema>;

export const GenerateRosterRequestSchema = z.object({
  patternId: z.guid(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employeeIds: z.array(z.guid()),
});
export type GenerateRosterRequest = z.infer<typeof GenerateRosterRequestSchema>;

export const ShiftSwapSchema = z.object({
  id: z.guid(),
  requesterId: z.guid(),
  requesterName: z.string().optional(),
  targetEmployeeId: z.guid(),
  targetEmployeeName: z.string().optional(),
  requesterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  reason: z.string().nullable().optional(),
  approverId: z.guid().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
});
export type ShiftSwap = z.infer<typeof ShiftSwapSchema>;

export const CreateShiftSwapRequestSchema = z.object({
  targetEmployeeId: z.guid(),
  requesterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
});
export type CreateShiftSwapRequest = z.infer<
  typeof CreateShiftSwapRequestSchema
>;

export const DecideShiftSwapRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});
export type DecideShiftSwapRequest = z.infer<
  typeof DecideShiftSwapRequestSchema
>;
