import crypto from "node:crypto";
import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateDocumentRequestSchema,
  BulkPayslipUploadRequestSchema,
  CreateDocumentTemplateSchema,
  RenderDocumentTemplateRequestSchema,
} from "@librehr/contracts";
import {
  validateDocumentFile,
  matchBulkPayslips,
  renderDocumentTemplate,
} from "@librehr/core";
import {
  withTenant,
  DocumentRepository,
  EmployeeRepository,
  OrganizationRepository,
  AuditRepository,
  encryptEnvelope,
  decryptEnvelope,
} from "@librehr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import type { StoragePort } from "../ports/storage.js";

export function createDocumentRoutes(sql: Sql, storagePort: StoragePort) {
  const router = new Hono();
  const docRepo = new DocumentRepository();
  const empRepo = new EmployeeRepository();
  const orgRepo = new OrganizationRepository();
  const auditRepo = new AuditRepository();

  // 1. GET /documents - List accessible documents
  router.get("/documents", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const employeeId = c.req.query("employeeId");
    const category = c.req.query("category");
    const isCompanyWideParam = c.req.query("isCompanyWide");
    const isCompanyWide =
      isCompanyWideParam !== undefined
        ? isCompanyWideParam === "true"
        : undefined;

    const docs = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const currentEmp = await empRepo.findByUserId(tx, user.id);

        // RBAC & Privacy enforcement (DOC-003)
        if (user.role === "employee") {
          if (employeeId && currentEmp && employeeId !== currentEmp.id) {
            return "FORBIDDEN";
          }
        }

        const targetEmployeeId =
          user.role === "employee" ? (currentEmp?.id ?? "none") : employeeId;

        const results = await docRepo.list(tx, {
          employeeId: isCompanyWide ? undefined : targetEmployeeId,
          category,
          isCompanyWide,
        });

        // Filter out payslips if user is not the employee and not an admin (DOC-003)
        return results.filter((doc) => {
          if (doc.category === "payslips") {
            return (
              user.role === "admin" ||
              (currentEmp && doc.employeeId === currentEmp.id)
            );
          }
          return true;
        });
      },
    );

    if (docs === "FORBIDDEN") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Employees can only view their own documents",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(
      docs.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
    );
  });

  // 2. POST /documents - Upload a document (DOC-001, DOC-002, DOC-004)
  router.post("/documents", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "document.write",
      { organizationId: user.organizationId },
    );

    if (!allowed) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Insufficient permissions to upload documents",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = CreateDocumentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 422,
          title: "Validation Error",
          detail: "Invalid document payload",
          code: "VALIDATION_ERROR",
        }),
        422,
        { "Content-Type": "application/problem+json" },
      );
    }

    const data = parsed.data;

    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(data.fileDataBase64, "base64");
    } catch {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Invalid base64 encoding",
          code: "INVALID_BASE64",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const valResult = validateDocumentFile(
      data.filename,
      data.mimeType,
      fileBuffer.length,
    );

    if (!valResult.valid) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: valResult.error ?? "Invalid file format or size",
          code: "FILE_VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    // Envelope encrypt file buffer (AES-256-GCM) per DOC-004
    const encryptedPayload = encryptEnvelope(fileBuffer.toString("base64"));
    const storageKey = `orgs/${user.organizationId}/docs/${crypto.randomUUID()}-${valResult.sanitizedFilename}`;

    await storagePort.put(
      storageKey,
      Buffer.from(encryptedPayload, "utf-8"),
      "application/octet-stream",
    );

    const sha256Hash = crypto
      .createHash("sha256")
      .update(fileBuffer)
      .digest("hex");

    const document = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await docRepo.createDocument(tx, {
          employeeId: data.employeeId,
          title: data.title,
          category: data.category,
          description: data.description,
          audienceType: data.audienceType,
          targetDepartmentId: data.targetDepartmentId,
          targetLocationId: data.targetLocationId,
          createdById: user.id,
          filename: valResult.sanitizedFilename,
          mimeType: data.mimeType,
          sizeBytes: fileBuffer.length,
          sha256Hash,
          storageKey,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "document.create",
          resourceType: "document",
          resourceId: created.id,
          metadata: {
            title: created.title,
            category: created.category,
            filename: valResult.sanitizedFilename,
          },
        });

        return created;
      },
    );

    return c.json(
      {
        ...document,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      },
      201,
    );
  });

  // 3. GET /documents/:id/download - Download and decrypt document
  router.get("/documents/:id/download", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const doc = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const found = await docRepo.findById(tx, id);
        if (!found) return null;

        const currentEmp = await empRepo.findByUserId(tx, user.id);

        // DOC-003: Privacy checks
        if (found.category === "payslips") {
          if (
            user.role !== "admin" &&
            (!currentEmp || currentEmp.id !== found.employeeId)
          ) {
            return "FORBIDDEN";
          }
        } else if (
          found.employeeId &&
          user.role === "employee" &&
          (!currentEmp || currentEmp.id !== found.employeeId)
        ) {
          return "FORBIDDEN";
        }

        return found;
      },
    );

    if (doc === "FORBIDDEN") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Cannot access private documents of other employees",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    if (!doc) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Document not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    const encryptedData = await storagePort.get(doc.latestStorageKey);
    if (!encryptedData) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "File storage asset not found",
          code: "FILE_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    let originalBuffer: Buffer;
    try {
      const decryptedBase64 = decryptEnvelope(encryptedData.toString("utf-8"));
      originalBuffer = Buffer.from(decryptedBase64, "base64");
    } catch {
      return c.json(
        createProblemDetails({
          status: 500,
          title: "Internal Server Error",
          detail: "Failed to decrypt document",
          code: "DECRYPTION_ERROR",
        }),
        500,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({
      id: doc.id,
      filename: doc.latestFilename,
      mimeType: doc.latestMimeType,
      sizeBytes: doc.latestSizeBytes,
      fileDataBase64: originalBuffer.toString("base64"),
    });
  });

  // 4. DELETE /documents/:id - Delete a document
  router.delete("/documents/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const id = c.req.param("id");

    const allowed = can(
      {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      "document.write",
      { organizationId: user.organizationId },
    );

    if (!allowed) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Insufficient permissions to delete documents",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const deleted = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const existing = await docRepo.findById(tx, id);
        if (!existing) return false;

        await docRepo.delete(tx, id);
        await auditRepo.log(tx, {
          actorId: user.id,
          action: "document.delete",
          resourceType: "document",
          resourceId: id,
          metadata: { title: existing.title },
        });

        await storagePort.delete(existing.latestStorageKey);
        return true;
      },
    );

    if (!deleted) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Document not found",
          code: "NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json({ success: true });
  });

  // 5. POST /documents/payslips/bulk - Bulk payslip matcher and upload (DOC-005)
  router.post("/documents/payslips/bulk", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Bulk payslip upload requires admin role",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = BulkPayslipUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 422,
          title: "Validation Error",
          detail: "Invalid bulk payslip payload",
          code: "VALIDATION_ERROR",
        }),
        422,
        { "Content-Type": "application/problem+json" },
      );
    }

    const { files, dryRun } = parsed.data;

    const report = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const empResult = await empRepo.list(tx, { pageSize: 100 });
        const employeeTargets = empResult.items.map((e) => ({
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          email: e.email,
        }));

        const filenames = files.map((f) => f.filename);
        const matchReport = matchBulkPayslips(filenames, employeeTargets);

        if (!dryRun) {
          for (const match of matchReport.matches) {
            if (match.status === "matched" && match.matchedEmployeeId) {
              const fileObj = files.find((f) => f.filename === match.filename);
              if (fileObj) {
                const buffer = Buffer.from(fileObj.fileDataBase64, "base64");
                const encryptedPayload = encryptEnvelope(
                  buffer.toString("base64"),
                );
                const storageKey = `orgs/${user.organizationId}/payslips/${match.matchedEmployeeId}/${match.periodYearMonth ?? "general"}-${match.filename}`;
                await storagePort.put(
                  storageKey,
                  Buffer.from(encryptedPayload, "utf-8"),
                  "application/octet-stream",
                );

                const sha256Hash = crypto
                  .createHash("sha256")
                  .update(buffer)
                  .digest("hex");
                await docRepo.createDocument(tx, {
                  employeeId: match.matchedEmployeeId,
                  title: `Payslip ${match.periodYearMonth ?? ""}`.trim(),
                  category: "payslips",
                  description: `Bulk uploaded payslip for ${match.periodYearMonth ?? "period"}`,
                  audienceType: "individual",
                  createdById: user.id,
                  filename: match.filename,
                  mimeType: fileObj.mimeType || "application/pdf",
                  sizeBytes: buffer.length,
                  sha256Hash,
                  storageKey,
                });
              }
            }
          }

          await auditRepo.log(tx, {
            actorId: user.id,
            action: "document.bulk_payslips_upload",
            resourceType: "document",
            resourceId: user.organizationId,
            metadata: {
              totalFiles: matchReport.totalFiles,
              matchedCount: matchReport.matchedCount,
              unmatchedCount: matchReport.unmatchedCount,
            },
          });
        }

        return matchReport;
      },
    );

    return c.json(report);
  });

  // DOC-006: Acknowledge document policy / read receipt
  router.post("/documents/:id/acknowledge", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const documentId = c.req.param("id");

    const ack = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const emp = await empRepo.findByUserId(tx, user.id);
        if (!emp) return null;

        const res = await docRepo.acknowledge(tx, documentId, emp.id);

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "document.acknowledged",
          resourceType: "document",
          resourceId: documentId,
          metadata: { employeeId: emp.id, acknowledgedAt: res.acknowledgedAt },
        });

        return res;
      },
    );

    if (!ack) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Employee profile not found for user",
        code: "EMPLOYEE_NOT_FOUND",
      });
      return c.json(problem, 404, {
        "Content-Type": "application/problem+json",
      });
    }

    return c.json({
      success: true,
      acknowledgedAt: ack.acknowledgedAt.toISOString(),
    });
  });

  router.get("/documents/:id/acknowledgements", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const documentId = c.req.param("id");

    const acks = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return docRepo.getAcknowledgements(tx, documentId);
      },
    );

    return c.json(acks);
  });

  // DOC-007: Document Templates & Merge Generation
  router.get("/documents/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const category = c.req.query("category");

    const templates = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        return docRepo.listTemplates(tx, category);
      },
    );

    return c.json(
      templates.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    );
  });

  router.post("/documents/templates", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin" && user.role !== "hr_admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only administrators and HR can manage document templates",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const body = await c.req.json();
    const parsed = CreateDocumentTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid document template payload",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const template = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const created = await docRepo.createTemplate(tx, {
          name: parsed.data.name,
          category: parsed.data.category,
          description: parsed.data.description,
          content: parsed.data.content,
          createdById: user.id,
        });

        await auditRepo.log(tx, {
          actorId: user.id,
          action: "document_template.created",
          resourceType: "document_templates",
          resourceId: created.id,
          metadata: { name: created.name, category: created.category },
        });

        return created;
      },
    );

    return c.json({
      ...template,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    });
  });

  router.post("/documents/templates/:id/render", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;
    const templateId = c.req.param("id");
    const body = await c.req.json();
    const parsed = RenderDocumentTemplateRequestSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Validation Error",
          detail: "Invalid render request payload",
          code: "VALIDATION_ERROR",
        }),
        400,
        { "Content-Type": "application/problem+json" },
      );
    }

    const result = await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        const template = await docRepo.getTemplateById(tx, templateId);
        if (!template) return "TEMPLATE_NOT_FOUND";

        const emp = await empRepo.findById(tx, parsed.data.employeeId);
        if (!emp) return "EMPLOYEE_NOT_FOUND";

        const org = await orgRepo.findById(tx, user.organizationId);

        const empContext: {
          name: string;
          firstName: string;
          lastName: string;
          email: string;
          department?: string;
          jobTitle?: string;
          hireDate?: string;
          address?: string;
        } = {
          name: `${emp.firstName} ${emp.lastName}`,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          ...(emp.departmentName ? { department: emp.departmentName } : {}),
          ...(emp.jobTitle ? { jobTitle: emp.jobTitle } : {}),
          ...(emp.startDate ? { hireDate: emp.startDate } : {}),
          ...(emp.address ? { address: emp.address } : {}),
        };

        const rendered = renderDocumentTemplate(
          template.content,
          {
            employee: empContext,
            organization: {
              name: org?.name ?? "LibreHR",
            },
            ...(parsed.data.customFields
              ? {
                  custom: parsed.data.customFields as Record<
                    string,
                    string | number
                  >,
                }
              : {}),
          },
          "[N/A]",
        );

        let createdDocId: string | undefined;

        if (parsed.data.saveAsDocument) {
          const docTitle =
            parsed.data.title ??
            `${template.name} - ${emp.firstName} ${emp.lastName}`;
          const renderedBuffer = Buffer.from(rendered, "utf-8");
          const encryptedPayload = encryptEnvelope(
            renderedBuffer.toString("base64"),
          );
          const sanitizedName = template.name
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "_");
          const storageKey = `orgs/${user.organizationId}/docs/${crypto.randomUUID()}-${sanitizedName}.txt`;
          await storagePort.put(
            storageKey,
            Buffer.from(encryptedPayload, "utf-8"),
            "application/octet-stream",
          );

          const sha256 = crypto
            .createHash("sha256")
            .update(renderedBuffer)
            .digest("hex");

          const doc = await docRepo.createDocument(tx, {
            employeeId: emp.id,
            title: docTitle,
            category: template.category,
            audienceType: "individual",
            createdById: user.id,
            filename: `${sanitizedName}.txt`,
            mimeType: "text/plain",
            sizeBytes: renderedBuffer.length,
            sha256Hash: sha256,
            storageKey,
          });

          createdDocId = doc.id;
        }

        return { renderedContent: rendered, documentId: createdDocId };
      },
    );

    if (result === "TEMPLATE_NOT_FOUND") {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Template Not Found",
          detail: "The requested document template does not exist",
          code: "TEMPLATE_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    if (result === "EMPLOYEE_NOT_FOUND") {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Employee Not Found",
          detail: "Target employee does not exist",
          code: "EMPLOYEE_NOT_FOUND",
        }),
        404,
        { "Content-Type": "application/problem+json" },
      );
    }

    return c.json(result);
  });

  router.delete("/documents/templates/:id", requireAuth, async (c) => {
    const user = (c.get as (key: string) => unknown)("user") as AuthUser;

    if (user.role !== "admin" && user.role !== "hr_admin") {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Only administrators can delete document templates",
          code: "FORBIDDEN",
        }),
        403,
        { "Content-Type": "application/problem+json" },
      );
    }

    const templateId = c.req.param("id");

    await withTenant(
      sql,
      { organizationId: user.organizationId, userId: user.id },
      async (tx) => {
        await docRepo.deleteTemplate(tx, templateId);
      },
    );

    return c.json({ success: true });
  });

  return router;
}
