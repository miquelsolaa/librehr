import { z } from "zod";

/**
 * ORG-007 (issue #81, ADR 0008): projects and areas. An area can hold
 * projects (one level). Groups are archived, never deleted.
 */
export const OrgGroupKindSchema = z.enum(["project", "area"]);
export type OrgGroupKind = z.infer<typeof OrgGroupKindSchema>;

export const OrgGroupSchema = z.object({
  id: z.guid(),
  kind: OrgGroupKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  parentId: z.guid().nullable(),
  leadEmployeeId: z.guid().nullable(),
  /** Optional planned dates (calendar dates, both included). */
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrgGroup = z.infer<typeof OrgGroupSchema>;

export const ListOrgGroupsQuerySchema = z.object({
  kind: OrgGroupKindSchema.optional(),
  /** "true" also lists archived groups. */
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export type ListOrgGroupsQuery = z.input<typeof ListOrgGroupsQuerySchema>;

const groupFields = {
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  /** An area id; only a project can have a parent. */
  parentId: z.guid().nullable().optional(),
  leadEmployeeId: z.guid().nullable().optional(),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
};

const datesInOrder = (g: {
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
}) => !g.startsOn || !g.endsOn || g.endsOn >= g.startsOn;
const datesMessage = {
  message: "End date must not precede start date",
  path: ["endsOn"],
};

export const CreateOrgGroupRequestSchema = z
  .object({ kind: OrgGroupKindSchema, ...groupFields })
  .refine(datesInOrder, datesMessage);
export type CreateOrgGroupRequest = z.infer<typeof CreateOrgGroupRequestSchema>;

/** Omitted fields are kept; null clears an optional field. */
export const UpdateOrgGroupRequestSchema = z
  .object({ ...groupFields, name: groupFields.name.optional() })
  .refine((g) => Object.values(g).some((v) => v !== undefined), {
    message: "Nothing to update",
  })
  .refine(datesInOrder, datesMessage);
export type UpdateOrgGroupRequest = z.infer<typeof UpdateOrgGroupRequestSchema>;
