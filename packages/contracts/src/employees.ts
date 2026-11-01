import { z } from "zod";

// TODO(EMP-001): Employee contract definitions
export const EmployeeSummarySchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
});
