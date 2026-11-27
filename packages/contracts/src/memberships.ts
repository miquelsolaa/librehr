import { z } from "zod";

/**
 * ORG-007 (issue #81, ADR 0008): secondary memberships of an employee in a
 * department, project or area. The primary department stays on the employee.
 * Dates are calendar dates (`YYYY-MM-DD`) in the organization's time zone;
 * the end date is included and null is open-ended.
 */
export const MembershipTargetTypeSchema = z.enum([
  "department",
  "project",
  "area",
]);
export type MembershipTargetType = z.infer<typeof MembershipTargetTypeSchema>;

/**
 * Why a membership was ended. A coarse code, never free text: health, union
 * membership or other special-category reasons must not be recorded
 * (COMPLIANCE.md). `primary_changed` is set by the API when the membership's
 * department becomes the primary one (ADR 0008 decision 3).
 */
export const MembershipEndReasonSchema = z.enum([
  "project_ended",
  "reassigned",
  "primary_changed",
  "other",
]);
export type MembershipEndReason = z.infer<typeof MembershipEndReasonSchema>;

/** The end reasons a person can pick; `primary_changed` is the API's own. */
export const SelectableMembershipEndReasonSchema =
  MembershipEndReasonSchema.exclude(["primary_changed"]);

export const AllocationPercentSchema = z
  .number()
  .positive("Must be greater than 0")
  .max(100, "Must be at most 100")
  .multipleOf(0.01, "At most two decimals")
  .describe("Optional share of the person's time, in (0, 100].");

export const EmployeeMembershipSchema = z.object({
  id: z.guid(),
  employeeId: z.guid(),
  departmentId: z.guid().nullable(),
  groupId: z.guid().nullable(),
  targetType: MembershipTargetTypeSchema,
  targetName: z.string(),
  /** Free label such as "member"; never used for authorization. */
  role: z.string().nullable(),
  allocationPercent: z.number().nullable(),
  startDate: z.string().date(),
  endDate: z.string().date().nullable(),
  endReason: MembershipEndReasonSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployeeMembership = z.infer<typeof EmployeeMembershipSchema>;

const RoleSchema = z.string().trim().min(1).max(100).nullable().optional();

const datesInOrder = (m: {
  startDate?: string | undefined;
  endDate?: string | null | undefined;
}) => !m.startDate || !m.endDate || m.endDate >= m.startDate;
const datesMessage = {
  message: "End date must not precede start date",
  path: ["endDate"],
};

/** Exactly one of departmentId and groupId. */
export const CreateEmployeeMembershipRequestSchema = z
  .object({
    departmentId: z.guid().optional(),
    groupId: z.guid().optional(),
    role: RoleSchema,
    allocationPercent: AllocationPercentSchema.nullable().optional(),
    startDate: z.string().date(),
    endDate: z.string().date().nullable().optional(),
  })
  .refine((m) => (m.departmentId === undefined) !== (m.groupId === undefined), {
    message: "Give exactly one of departmentId and groupId",
    path: ["departmentId"],
  })
  .refine(datesInOrder, datesMessage);
export type CreateEmployeeMembershipRequest = z.infer<
  typeof CreateEmployeeMembershipRequestSchema
>;

/**
 * Omitted fields are kept; null clears an optional field. Once a membership
 * was ended through `/end`, only role and allocation can change: its dates
 * are history (409 MEMBERSHIP_ALREADY_ENDED).
 */
export const UpdateEmployeeMembershipRequestSchema = z
  .object({
    role: RoleSchema,
    allocationPercent: AllocationPercentSchema.nullable().optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().nullable().optional(),
  })
  .refine((m) => Object.values(m).some((v) => v !== undefined), {
    message: "Nothing to update",
  })
  .refine(datesInOrder, datesMessage);
export type UpdateEmployeeMembershipRequest = z.infer<
  typeof UpdateEmployeeMembershipRequestSchema
>;

export const EndEmployeeMembershipRequestSchema = z.object({
  /** Last day of the membership (included). */
  endDate: z.string().date(),
  reason: SelectableMembershipEndReasonSchema.nullable().optional(),
});
export type EndEmployeeMembershipRequest = z.infer<
  typeof EndEmployeeMembershipRequestSchema
>;

/**
 * Result of a create or update. `overAllocation` is a warning, never a block
 * (ADR 0008 D3): the first day on which the person's secondary allocations
 * add up to more than 100%, or null.
 */
export const EmployeeMembershipWriteResponseSchema = z.object({
  membership: EmployeeMembershipSchema,
  overAllocation: z
    .object({ date: z.string().date(), totalPercent: z.number() })
    .nullable(),
});
export type EmployeeMembershipWriteResponse = z.infer<
  typeof EmployeeMembershipWriteResponseSchema
>;
