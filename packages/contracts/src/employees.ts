import { z } from "zod";

export const EmployeeStatusSchema = z.enum([
  "active",
  "on_leave",
  "terminated",
]);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const TerminationReasonSchema = z.enum([
  "voluntary_resignation",
  "dismissal_disciplinary",
  "dismissal_objective",
  "contract_expiry",
  "retirement",
  "other",
]);
export type TerminationReason = z.infer<typeof TerminationReasonSchema>;

export const ListEmployeesQuerySchema = z.object({
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  status: EmployeeStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;

export const EmployeeListItemSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  email: z.string().email(),
  status: z.string(),
  departmentName: z.string().nullable(),
  locationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  managerName: z.string().nullable(),
});
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;

export const ListEmployeesResponseSchema = z.object({
  items: z.array(EmployeeListItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ListEmployeesResponse = z.infer<typeof ListEmployeesResponseSchema>;

export const EmployeeProfileSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  departmentId: z.string().uuid().nullable(),
  managerId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  email: z.string().email(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  birthDate: z.string().nullable(),
  status: z.string(),
  terminationDate: z.string().nullable(),
  terminationReason: z.string().nullable(),
  departmentName: z.string().nullable(),
  locationName: z.string().nullable(),
  managerName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  employmentType: z.string().nullable(),
  startDate: z.string().nullable(),
  hasNationalId: z.boolean(),
  hasIban: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployeeProfile = z.infer<typeof EmployeeProfileSchema>;

export const CreateEmployeeRequestSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  preferredName: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD")
    .nullable()
    .optional(),
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  jobTitle: z.string().optional(),
  employmentType: z.string().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD")
    .optional(),
  nationalId: z.string().optional(),
  iban: z.string().optional(),
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;

export const UpdateEmployeeRequestSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  preferredName: z.string().nullable().optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  departmentId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  status: EmployeeStatusSchema.optional(),
  nationalId: z.string().optional(),
  iban: z.string().optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequestSchema>;

export const TerminateEmployeeRequestSchema = z.object({
  terminationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format must be YYYY-MM-DD"),
  terminationReason: TerminationReasonSchema,
});
export type TerminateEmployeeRequest = z.infer<
  typeof TerminateEmployeeRequestSchema
>;

export const RevealFieldRequestSchema = z.object({
  field: z.enum(["nationalId", "iban"]),
});
export type RevealFieldRequest = z.infer<typeof RevealFieldRequestSchema>;

export const RevealFieldResponseSchema = z.object({
  field: z.enum(["nationalId", "iban"]),
  value: z.string().nullable(),
});
export type RevealFieldResponse = z.infer<typeof RevealFieldResponseSchema>;
