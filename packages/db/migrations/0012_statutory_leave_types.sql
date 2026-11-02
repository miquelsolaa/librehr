-- Migration 0012_statutory_leave_types.sql
-- Statutory Leave Types & Attachments (Estatuto de los Trabajadores art. 37 & RDL 5/2023)

ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "requires_attachment" boolean NOT NULL DEFAULT false;
ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "legal_reference" text;
ALTER TABLE "leave_types" ADD COLUMN IF NOT EXISTS "description" text;
