import crypto from "node:crypto";
import { Hono } from "hono";
import type { Sql } from "postgres";
import {
  type AuthUser,
  createProblemDetails,
  CreateDocumentRequestSchema,
  BulkPayslipUploadRequestSchema,
} from "@openhr/contracts";
import { validateDocumentFile, matchBulkPayslips } from "@openhr/core";
import {
  withTenant,
  DocumentRepository,
  EmployeeRepository,
  AuditRepository,
  encryptEnvelope,
  decryptEnvelope,
} from "@openhr/db";
import { requireAuth } from "../middleware/auth.js";
import { can } from "../policies/can.js";
import type { StoragePort } from "../ports/storage.js";

export function createDocumentRoutes(sql: Sql, storagePort: StoragePort) {
  const router = new Hono();
  const docRepo = new DocumentRepository();
  const empRepo = new EmployeeRepository();
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

  return router;
}
