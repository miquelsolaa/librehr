import { z } from "zod";

export const CustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "select",
]);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldVisibilitySchema = z.enum([
  "admin",
  "hr",
  "manager",
  "employee",
  "public",
]);
export type CustomFieldVisibility = z.infer<typeof CustomFieldVisibilitySchema>;

export const CustomFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  fieldType: CustomFieldTypeSchema,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  visibility: CustomFieldVisibilitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export const CreateCustomFieldDefinitionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  fieldType: CustomFieldTypeSchema,
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  visibility: CustomFieldVisibilitySchema.optional(),
});
export type CreateCustomFieldDefinition = z.infer<
  typeof CreateCustomFieldDefinitionSchema
>;

export const CustomFieldValueSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  fieldDefinitionId: z.string().uuid(),
  employeeId: z.string().uuid(),
  value: z.string().nullable(),
  fieldName: z.string().optional(),
  fieldCode: z.string().optional(),
  fieldType: z.string().optional(),
  options: z.array(z.string()).nullable().optional(),
  visibility: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;

export const SetCustomFieldValueSchema = z.object({
  fieldDefinitionId: z.string().uuid(),
  value: z.string().nullable(),
});
export type SetCustomFieldValue = z.infer<typeof SetCustomFieldValueSchema>;
