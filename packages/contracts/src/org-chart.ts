import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

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
  directReportsCount: number;
  totalTeamCount: number;
  directReports: OrgChartNode[];
}

export const OrgChartNodeSchema: z.ZodType<OrgChartNode> = z
  .lazy(() =>
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      preferredName: z.string().nullable(),
      email: z.string().email(),
      jobTitle: z.string().nullable(),
      departmentId: z.string().uuid().nullable(),
      departmentName: z.string().nullable(),
      locationName: z.string().nullable(),
      managerId: z.string().uuid().nullable(),
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
