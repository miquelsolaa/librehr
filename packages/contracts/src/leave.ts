import { z } from "zod";

// TODO(LEA-001): Leave contracts
export const LeaveRequestSummarySchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
});
