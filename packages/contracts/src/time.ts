import { z } from "zod";

// TODO(TIM-001): Time contracts
export const TimeEventSummarySchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  type: z.enum(["clock_in", "clock_out", "break_start", "break_end"]),
  occurredAt: z.string().datetime(),
});
