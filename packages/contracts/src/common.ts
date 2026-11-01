import { z } from "zod";

export const IdSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime();
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
