import { z } from "zod";

export const DocumentCategorySchema = z.enum([
  "contracts",
  "payslips",
  "certificates",
  "company_policies",
  "other",
]);
export type DocumentCategory = z.infer<typeof DocumentCategorySchema>;

export const DocumentItemSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid().nullable(),
  employeeName: z.string().nullable().optional(),
  title: z.string(),
  category: DocumentCategorySchema,
  description: z.string().nullable().optional(),
  audienceType: z.enum(["individual", "company", "department", "location"]),
  targetDepartmentId: z.string().uuid().nullable().optional(),
  targetLocationId: z.string().uuid().nullable().optional(),
  createdById: z.string().uuid(),
  latestVersionNumber: z.number().int(),
  latestFilename: z.string(),
  latestMimeType: z.string(),
  latestSizeBytes: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentItem = z.infer<typeof DocumentItemSchema>;

export const CreateDocumentRequestSchema = z.object({
  employeeId: z.string().uuid().optional(),
  title: z.string().min(1, "Title is required"),
  category: DocumentCategorySchema,
  description: z.string().optional(),
  audienceType: z
    .enum(["individual", "company", "department", "location"])
    .default("individual"),
  targetDepartmentId: z.string().uuid().optional(),
  targetLocationId: z.string().uuid().optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  fileDataBase64: z.string().min(1, "File content is required"),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const BulkPayslipMatchItemSchema = z.object({
  filename: z.string(),
  matchedEmployeeId: z.string().uuid().nullable(),
  employeeName: z.string().optional(),
  periodYearMonth: z.string().optional(),
  status: z.enum(["matched", "unmatched", "ambiguous"]),
  error: z.string().optional(),
});
export type BulkPayslipMatchItem = z.infer<typeof BulkPayslipMatchItemSchema>;

export const BulkPayslipReportSchema = z.object({
  totalFiles: z.number().int(),
  matchedCount: z.number().int(),
  unmatchedCount: z.number().int(),
  matches: z.array(BulkPayslipMatchItemSchema),
});
export type BulkPayslipReport = z.infer<typeof BulkPayslipReportSchema>;

export const BulkPayslipUploadRequestSchema = z.object({
  files: z.array(
    z.object({
      filename: z.string(),
      fileDataBase64: z.string(),
      mimeType: z.string().default("application/pdf"),
    }),
  ),
  dryRun: z.boolean().default(false),
});
export type BulkPayslipUploadRequest = z.infer<
  typeof BulkPayslipUploadRequestSchema
>;
