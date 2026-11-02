import { describe, it, expect } from "vitest";
import {
  extractTemplateVariables,
  renderDocumentTemplate,
} from "../src/documents/merge-templates.js";

describe("Document Template Merge Engine", () => {
  const sampleTemplate = `
# Certificat d'Empresa / Certificate of Employment

Per la present es certifica que **{{employee.name}}**, amb DNI/NIE **{{employee.dni}}**,
presta els seus serveis a **{{organization.name}}** (CIF {{organization.cif}})
en el lloc de **{{employee.job_title}}** des del **{{employee.hire_date}}**.

Salari brut anual: {{employee.salary}} €
Data d'emissió: {{current_date}}
`;

  it("extracts all merge tags from template", () => {
    const vars = extractTemplateVariables(sampleTemplate);
    expect(vars).toContain("employee.name");
    expect(vars).toContain("employee.dni");
    expect(vars).toContain("organization.name");
    expect(vars).toContain("organization.cif");
    expect(vars).toContain("employee.job_title");
    expect(vars).toContain("employee.hire_date");
    expect(vars).toContain("employee.salary");
    expect(vars).toContain("current_date");
  });

  it("merges employee and organization variables accurately", () => {
    const rendered = renderDocumentTemplate(
      sampleTemplate,
      {
        employee: {
          name: "Maria Puig",
          taxId: "47123456Z",
          jobTitle: "Senior Software Engineer",
          hireDate: "2023-01-15",
          salary: "45000",
        },
        organization: {
          name: "Acme Tech SL",
          taxId: "B12345678",
        },
        currentDate: "2026-11-02",
      },
      "[N/A]",
    );

    expect(rendered).toContain("Maria Puig");
    expect(rendered).toContain("47123456Z");
    expect(rendered).toContain("Acme Tech SL");
    expect(rendered).toContain("B12345678");
    expect(rendered).toContain("Senior Software Engineer");
    expect(rendered).toContain("2023-01-15");
    expect(rendered).toContain("45000 €");
    expect(rendered).toContain("2026-11-02");
  });

  it("handles missing variables safely with fallback string", () => {
    const rendered = renderDocumentTemplate(
      "Hello {{employee.name}}, welcome to {{organization.name}} (dep: {{employee.department}})",
      {
        employee: { name: "Bob" },
      },
      "[No Especificat]",
    );

    expect(rendered).toBe(
      "Hello Bob, welcome to [No Especificat] (dep: [No Especificat])",
    );
  });
});
