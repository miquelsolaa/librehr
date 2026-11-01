import { z } from "zod";

export const FieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const ProblemDetailsSchema = z.object({
  type: z.string().default("about:blank"),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().optional(),
  traceId: z.string().optional(),
  errors: z.array(FieldErrorSchema).optional(),
});

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export function createProblemDetails(params: {
  status: number;
  title: string;
  detail?: string | undefined;
  code?: string | undefined;
  traceId?: string | undefined;
  instance?: string | undefined;
  errors?: Array<{ field: string; message: string }> | undefined;
}): ProblemDetails {
  return {
    type: "about:blank",
    status: params.status,
    title: params.title,
    ...(params.detail ? { detail: params.detail } : {}),
    ...(params.code ? { code: params.code } : {}),
    ...(params.traceId ? { traceId: params.traceId } : {}),
    ...(params.instance ? { instance: params.instance } : {}),
    ...(params.errors ? { errors: params.errors } : {}),
  };
}
