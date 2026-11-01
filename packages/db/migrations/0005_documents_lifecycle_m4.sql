-- OpenHR Migration 0005: Documents, Document Versions, Checklist Templates, Checklist Runs (M4)

-- 1. Documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  description text,
  audience_type text NOT NULL DEFAULT 'individual',
  target_department_id uuid,
  target_location_id uuid,
  created_by_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_org_idx ON documents(organization_id);
CREATE INDEX IF NOT EXISTS documents_employee_idx ON documents(employee_id);
CREATE INDEX IF NOT EXISTS documents_category_idx ON documents(category);

-- 2. Document versions
CREATE TABLE IF NOT EXISTS document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256_hash text NOT NULL,
  uploaded_by_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_versions_document_idx ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS document_versions_org_idx ON document_versions(organization_id);

-- 3. Document acknowledgements
CREATE TABLE IF NOT EXISTS document_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_acks_document_idx ON document_acknowledgements(document_id);
CREATE INDEX IF NOT EXISTS document_acks_employee_idx ON document_acknowledgements(employee_id);

-- 4. Checklist templates
CREATE TABLE IF NOT EXISTS checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_templates_org_idx ON checklist_templates(organization_id);

-- 5. Checklist template tasks
CREATE TABLE IF NOT EXISTS checklist_template_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_role text NOT NULL DEFAULT 'employee',
  due_offset_days integer NOT NULL DEFAULT 0,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_tasks_template_idx ON checklist_template_tasks(template_id);

-- 6. Checklist instances
CREATE TABLE IF NOT EXISTS checklist_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id uuid REFERENCES checklist_templates(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  base_date date NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_instances_org_idx ON checklist_instances(organization_id);
CREATE INDEX IF NOT EXISTS checklist_instances_employee_idx ON checklist_instances(employee_id);

-- 7. Checklist run tasks
CREATE TABLE IF NOT EXISTS checklist_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assigned_role text NOT NULL DEFAULT 'employee',
  assignee_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  is_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_run_tasks_instance_idx ON checklist_tasks(instance_id);
CREATE INDEX IF NOT EXISTS checklist_run_tasks_assignee_idx ON checklist_tasks(assignee_employee_id);

-- 8. Enable and force RLS on all 7 tables
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE document_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_acknowledgements FORCE ROW LEVEL SECURITY;

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE checklist_template_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_instances FORCE ROW LEVEL SECURITY;

ALTER TABLE checklist_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_tasks FORCE ROW LEVEL SECURITY;

-- 9. Tenant isolation policies
DROP POLICY IF EXISTS tenant_isolation_policy ON documents;
CREATE POLICY tenant_isolation_policy ON documents
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON document_versions;
CREATE POLICY tenant_isolation_policy ON document_versions
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON document_acknowledgements;
CREATE POLICY tenant_isolation_policy ON document_acknowledgements
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON checklist_templates;
CREATE POLICY tenant_isolation_policy ON checklist_templates
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON checklist_template_tasks;
CREATE POLICY tenant_isolation_policy ON checklist_template_tasks
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON checklist_instances;
CREATE POLICY tenant_isolation_policy ON checklist_instances
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON checklist_tasks;
CREATE POLICY tenant_isolation_policy ON checklist_tasks
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);
