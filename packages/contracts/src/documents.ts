import { z } from "zod";

// TODO(DOC-001): Document contracts
export const DocumentSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  mimeType: z.string(),
});
