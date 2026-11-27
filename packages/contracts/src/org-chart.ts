import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

/**
 * ORG-007: a secondary membership active today, drawn as a dotted line to
 * the lead of the department, project or area.
 */
export const OrgChartMembershipSchema = z.object({
  type: z.enum(["department", "project", "area"]),
  id: z.guid(),
  name: z.string(),
  allocationPercent: z.number().nullable(),
  leadEmployeeId: z.guid().nullable(),
  leadName: z.string().nullable(),
});
export type OrgChartMembership = z.infer<typeof OrgChartMembershipSchema>;

export interface OrgChartNode {
  id: string;
  name: string;
  preferredName: string | null;
  email: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationName: string | null;
  managerId: string | null;
  secondaryMemberships: OrgChartMembership[];
  directReportsCount: number;
  totalTeamCount: number;
  directReports: OrgChartNode[];
}

export const OrgChartNodeSchema: z.ZodType<OrgChartNode> = z
  .lazy(() =>
    z.object({
      id: z.guid(),
      name: z.string(),
      preferredName: z.string().nullable(),
      email: z.string().email(),
      jobTitle: z.string().nullable(),
      departmentId: z.guid().nullable(),
      departmentName: z.string().nullable(),
      locationName: z.string().nullable(),
      managerId: z.guid().nullable(),
      secondaryMemberships: z.array(OrgChartMembershipSchema),
      directReportsCount: z.number().int(),
      totalTeamCount: z.number().int(),
      directReports: z.array(OrgChartNodeSchema),
    }),
  )
  .openapi({
    type: "object",
    description: "Org chart hierarchy node",
  });

export const OrgChartResponseSchema = z.object({
  roots: z.array(OrgChartNodeSchema),
  totalEmployees: z.number().int(),
});
export type OrgChartResponse = z.infer<typeof OrgChartResponseSchema>;
