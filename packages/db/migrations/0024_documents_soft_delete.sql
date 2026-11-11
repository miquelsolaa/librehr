-- 0024_documents_soft_delete.sql
-- DOC-001: deleting a document is a soft delete. The row, its versions and
-- the stored files are kept for retention enforcement (ADM-005), which purges
-- them later; until then the document is hidden from every read path.
-- Additive and nullable, so existing rows stay live. Who deleted a document is
-- recorded in the audit log (`document.delete`), not on the row.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Read paths filter on live documents of one organization.
CREATE INDEX IF NOT EXISTS documents_live_org_idx
  ON documents (organization_id)
  WHERE deleted_at IS NULL;
