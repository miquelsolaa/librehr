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

// DOC-007: Document Templates
export const DocumentTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string(),
  description: z.string().nullable().optional(),
  content: z.string(),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;

export const CreateDocumentTemplateSchema = z.object({
  name: z.string().min(1, "Template name is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().optional(),
  content: z.string().min(1, "Template content is required"),
});
export type CreateDocumentTemplate = z.infer<
  typeof CreateDocumentTemplateSchema
>;

export const RenderDocumentTemplateRequestSchema = z.object({
  employeeId: z.string().uuid(),
  saveAsDocument: z.boolean().default(false),
  title: z.string().optional(),
  customFields: z.record(z.union([z.string(), z.number()])).optional(),
});
export type RenderDocumentTemplateRequest = z.infer<
  typeof RenderDocumentTemplateRequestSchema
>;

export const RenderDocumentTemplateResponseSchema = z.object({
  renderedContent: z.string(),
  documentId: z.string().uuid().optional(),
});
export type RenderDocumentTemplateResponse = z.infer<
  typeof RenderDocumentTemplateResponseSchema
>;
