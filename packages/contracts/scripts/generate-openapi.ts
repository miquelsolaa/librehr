import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
import { ProblemDetailsSchema } from "../src/errors.js";
import {
  SignInRequestSchema,
  SessionResponseSchema,
  MeResponseSchema,
} from "../src/auth.js";
import {
  OrganizationResponseSchema,
  UpdateOrganizationSchema,
  DepartmentSchema,
  CreateDepartmentRequestSchema,
  LocationSchema,
  CreateLocationRequestSchema,
  SetupWizardRequestSchema,
} from "../src/org.js";
import {
  EmployeeListItemSchema,
  ListEmployeesResponseSchema,
  EmployeeProfileSchema,
  CreateEmployeeRequestSchema,
  UpdateEmployeeRequestSchema,
  TerminateEmployeeRequestSchema,
  RevealFieldRequestSchema,
  RevealFieldResponseSchema,
} from "../src/employees.js";
import {
  CreateInvitationRequestSchema,
  InvitationResponseSchema,
  AcceptInvitationRequestSchema,
  InvitationDetailsSchema,
} from "../src/invitations.js";
import {
  LeaveTypeSchema,
  CreateLeaveTypeRequestSchema,
  LeavePolicySchema,
  LeaveBalanceSummarySchema,
  LeaveLedgerEntrySchema,
  LeaveRequestSchema,
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  AdjustBalanceRequestSchema,
  HolidaySchema,
  TeamAbsenceSchema,
} from "../src/leave.js";
import {
  NotificationItemSchema,
  NotificationListResponseSchema,
} from "../src/notifications.js";
import {
  TimeEventSchema,
  ClockRequestSchema,
  ClockStatusResponseSchema,
  PeriodTimesheetResponseSchema,
  CreateTimeCorrectionSchema,
  DecideTimeCorrectionSchema,
  TimeCorrectionItemSchema,
  OfficialExportResponseSchema,
} from "../src/time.js";
import {
  DocumentItemSchema,
  CreateDocumentRequestSchema,
  BulkPayslipReportSchema,
  BulkPayslipUploadRequestSchema,
} from "../src/documents.js";
import {
  ChecklistTemplateSchema,
  CreateChecklistTemplateSchema,
  ChecklistInstanceSchema,
  InstantiateChecklistSchema,
  EmployeeImportValidationResponseSchema,
  DataSubjectExportResponseSchema,
} from "../src/lifecycle.js";
import {
  ReportsSummaryResponseSchema,
  GestoriaExportQuerySchema as _GestoriaExportQuerySchema,
} from "../src/reports.js";
import {
  PersonalAccessTokenSchema,
  CreatePersonalAccessTokenSchema,
  TokenCreatedResponseSchema,
} from "../src/tokens.js";
import {
  CustomFieldDefinitionSchema,
  CreateCustomFieldDefinitionSchema,
  CustomFieldValueSchema,
  SetCustomFieldValueSchema,
} from "../src/custom-fields.js";
import {
  EmergencyContactSchema,
  CreateEmergencyContactSchema,
  UpdateEmergencyContactSchema,
} from "../src/emergency-contacts.js";
import {
  OrgChartResponseSchema,
  OrgChartNodeSchema,
} from "../src/org-chart.js";
import { SelfServiceUpdateSchema } from "../src/employees.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registry = new OpenAPIRegistry();

// Register schemas
registry.register("ProblemDetails", ProblemDetailsSchema);
registry.register("SignInRequest", SignInRequestSchema);
registry.register("SessionResponse", SessionResponseSchema);
registry.register("MeResponse", MeResponseSchema);
registry.register("OrganizationResponse", OrganizationResponseSchema);
registry.register("UpdateOrganization", UpdateOrganizationSchema);
registry.register("Department", DepartmentSchema);
registry.register("CreateDepartmentRequest", CreateDepartmentRequestSchema);
registry.register("Location", LocationSchema);
registry.register("CreateLocationRequest", CreateLocationRequestSchema);
registry.register("SetupWizardRequest", SetupWizardRequestSchema);
registry.register("EmployeeListItem", EmployeeListItemSchema);
registry.register("ListEmployeesResponse", ListEmployeesResponseSchema);
registry.register("EmployeeProfile", EmployeeProfileSchema);
registry.register("CreateEmployeeRequest", CreateEmployeeRequestSchema);
registry.register("UpdateEmployeeRequest", UpdateEmployeeRequestSchema);
registry.register("TerminateEmployeeRequest", TerminateEmployeeRequestSchema);
registry.register("RevealFieldRequest", RevealFieldRequestSchema);
registry.register("RevealFieldResponse", RevealFieldResponseSchema);
registry.register("CreateInvitationRequest", CreateInvitationRequestSchema);
registry.register("InvitationResponse", InvitationResponseSchema);
registry.register("AcceptInvitationRequest", AcceptInvitationRequestSchema);
registry.register("InvitationDetails", InvitationDetailsSchema);
registry.register("LeaveType", LeaveTypeSchema);
registry.register("CreateLeaveTypeRequest", CreateLeaveTypeRequestSchema);
registry.register("LeavePolicy", LeavePolicySchema);
registry.register("LeaveBalanceSummary", LeaveBalanceSummarySchema);
registry.register("LeaveLedgerEntry", LeaveLedgerEntrySchema);
registry.register("LeaveRequest", LeaveRequestSchema);
registry.register("CreateLeaveRequest", CreateLeaveRequestSchema);
registry.register("DecideLeaveRequest", DecideLeaveRequestSchema);
registry.register("AdjustBalanceRequest", AdjustBalanceRequestSchema);
registry.register("Holiday", HolidaySchema);
registry.register("TeamAbsence", TeamAbsenceSchema);
registry.register("NotificationItem", NotificationItemSchema);
registry.register("NotificationListResponse", NotificationListResponseSchema);
registry.register("TimeEvent", TimeEventSchema);
registry.register("ClockRequest", ClockRequestSchema);
registry.register("ClockStatusResponse", ClockStatusResponseSchema);
registry.register("PeriodTimesheetResponse", PeriodTimesheetResponseSchema);
registry.register("CreateTimeCorrection", CreateTimeCorrectionSchema);
registry.register("DecideTimeCorrection", DecideTimeCorrectionSchema);
registry.register("TimeCorrectionItem", TimeCorrectionItemSchema);
registry.register("OfficialExportResponse", OfficialExportResponseSchema);
registry.register("DocumentItem", DocumentItemSchema);
registry.register("CreateDocumentRequest", CreateDocumentRequestSchema);
registry.register("BulkPayslipReport", BulkPayslipReportSchema);
registry.register("BulkPayslipUploadRequest", BulkPayslipUploadRequestSchema);
registry.register("ChecklistTemplate", ChecklistTemplateSchema);
registry.register("CreateChecklistTemplate", CreateChecklistTemplateSchema);
registry.register("ChecklistInstance", ChecklistInstanceSchema);
registry.register("InstantiateChecklist", InstantiateChecklistSchema);
registry.register(
  "EmployeeImportValidationResponse",
  EmployeeImportValidationResponseSchema,
);
registry.register("DataSubjectExportResponse", DataSubjectExportResponseSchema);
registry.register("ReportsSummaryResponse", ReportsSummaryResponseSchema);
registry.register("PersonalAccessToken", PersonalAccessTokenSchema);
registry.register("CreatePersonalAccessToken", CreatePersonalAccessTokenSchema);
registry.register("TokenCreatedResponse", TokenCreatedResponseSchema);
registry.register("CustomFieldDefinition", CustomFieldDefinitionSchema);
registry.register(
  "CreateCustomFieldDefinition",
  CreateCustomFieldDefinitionSchema,
);
registry.register("CustomFieldValue", CustomFieldValueSchema);
registry.register("SetCustomFieldValue", SetCustomFieldValueSchema);
registry.register("EmergencyContact", EmergencyContactSchema);
registry.register("CreateEmergencyContact", CreateEmergencyContactSchema);
registry.register("UpdateEmergencyContact", UpdateEmergencyContactSchema);
registry.register("OrgChartNode", OrgChartNodeSchema);
registry.register("OrgChartResponse", OrgChartResponseSchema);
registry.register("SelfServiceUpdate", SelfServiceUpdateSchema);

// Register endpoints
registry.registerPath({
  method: "get",
  path: "/healthz",
  summary: "Liveness check",
  responses: { 200: { description: "API is healthy and alive" } },
});

registry.registerPath({
  method: "get",
  path: "/readyz",
  summary: "Readiness check",
  responses: {
    200: { description: "API and database are ready" },
    503: { description: "Service unavailable" },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/auth/sign-in",
  summary: "Authenticate with email and password",
  request: {
    body: { content: { "application/json": { schema: SignInRequestSchema } } },
  },
  responses: {
    200: {
      description: "Authentication successful",
      content: { "application/json": { schema: SessionResponseSchema } },
    },
    400: {
      description: "Validation failure",
      content: { "application/problem+json": { schema: ProblemDetailsSchema } },
    },
    401: {
      description: "Invalid credentials",
      content: { "application/problem+json": { schema: ProblemDetailsSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/me",
  summary: "Get current authenticated user and organization session",
  responses: {
    200: {
      description: "Current user session profile",
      content: { "application/json": { schema: MeResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/problem+json": { schema: ProblemDetailsSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/org",
  summary: "Get active organization details",
  responses: {
    200: {
      description: "Organization details",
      content: { "application/json": { schema: OrganizationResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/problem+json": { schema: ProblemDetailsSchema } },
    },
  },
});

// Employees
registry.registerPath({
  method: "get",
  path: "/v1/employees",
  summary: "List employees with search, filter, and pagination",
  responses: {
    200: {
      description: "Paginated list of employees",
      content: { "application/json": { schema: ListEmployeesResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/employees",
  summary: "Create a new employee with encrypted sensitive fields",
  request: {
    body: {
      content: { "application/json": { schema: CreateEmployeeRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Employee created successfully",
      content: { "application/json": { schema: EmployeeProfileSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/employees/{id}",
  summary: "Get employee profile by ID",
  responses: {
    200: {
      description: "Employee profile details",
      content: { "application/json": { schema: EmployeeProfileSchema } },
    },
    404: {
      description: "Employee not found",
      content: { "application/problem+json": { schema: ProblemDetailsSchema } },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/employees/{id}",
  summary: "Update employee profile details",
  request: {
    body: {
      content: { "application/json": { schema: UpdateEmployeeRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Employee updated successfully",
      content: { "application/json": { schema: EmployeeProfileSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/employees/{id}/terminate",
  summary: "Offboard / terminate an employee with statutory reason",
  request: {
    body: {
      content: {
        "application/json": { schema: TerminateEmployeeRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Employee terminated successfully",
      content: { "application/json": { schema: EmployeeProfileSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/employees/{id}/reveal",
  summary: "Reveal sensitive employee field (audited)",
  request: {
    body: {
      content: { "application/json": { schema: RevealFieldRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Decrypted sensitive value",
      content: { "application/json": { schema: RevealFieldResponseSchema } },
    },
  },
});

// Organization structure & setup
registry.registerPath({
  method: "get",
  path: "/v1/org/departments",
  summary: "List all organization departments",
  responses: {
    200: {
      description: "List of departments",
      content: { "application/json": { schema: z.array(DepartmentSchema) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/org/departments",
  summary: "Create a new department",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateDepartmentRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Department created",
      content: { "application/json": { schema: DepartmentSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/org/locations",
  summary: "List all locations / work centers",
  responses: {
    200: {
      description: "List of locations",
      content: { "application/json": { schema: z.array(LocationSchema) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/org/locations",
  summary: "Create a new location",
  request: {
    body: {
      content: { "application/json": { schema: CreateLocationRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Location created",
      content: { "application/json": { schema: LocationSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/org/setup-wizard",
  summary: "Bootstrap initial organization and admin (First-run wizard)",
  request: {
    body: {
      content: { "application/json": { schema: SetupWizardRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Organization bootstrapped successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            organizationId: z.string().uuid(),
          }),
        },
      },
    },
  },
});

// Invitations
registry.registerPath({
  method: "post",
  path: "/v1/invitations",
  summary: "Invite a new member via email",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateInvitationRequestSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Invitation created and email queued",
      content: { "application/json": { schema: InvitationResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/invitations/{token}",
  summary: "Validate invitation token and retrieve details",
  responses: {
    200: {
      description: "Invitation details",
      content: { "application/json": { schema: InvitationDetailsSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/invitations/accept",
  summary: "Accept invitation and complete user account registration",
  request: {
    body: {
      content: {
        "application/json": { schema: AcceptInvitationRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Invitation accepted and session created",
      content: { "application/json": { schema: SessionResponseSchema } },
    },
  },
});

// Leave & Time off (M2)
registry.registerPath({
  method: "get",
  path: "/v1/leave/types",
  summary: "List leave types configured for organization",
  responses: {
    200: {
      description: "List of leave types",
      content: { "application/json": { schema: z.array(LeaveTypeSchema) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leave/types",
  summary: "Create a new leave type",
  request: {
    body: {
      content: { "application/json": { schema: CreateLeaveTypeRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Leave type created",
      content: { "application/json": { schema: LeaveTypeSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leave/balance",
  summary: "Get current employee leave balance and ledger history",
  responses: {
    200: {
      description: "Balance summary and ledger timeline",
      content: { "application/json": { schema: LeaveBalanceSummarySchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/leave/requests",
  summary: "List leave requests",
  responses: {
    200: {
      description: "List of leave requests",
      content: { "application/json": { schema: z.array(LeaveRequestSchema) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leave/requests",
  summary: "Submit a new leave request",
  request: {
    body: {
      content: { "application/json": { schema: CreateLeaveRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Leave request submitted",
      content: { "application/json": { schema: LeaveRequestSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leave/requests/{id}/decide",
  summary: "Approve or reject a pending leave request",
  request: {
    body: {
      content: { "application/json": { schema: DecideLeaveRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Leave request status updated",
      content: { "application/json": { schema: LeaveRequestSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leave/requests/{id}/cancel",
  summary: "Cancel a leave request with compensating ledger reversal",
  responses: {
    200: {
      description: "Leave request cancelled",
      content: { "application/json": { schema: LeaveRequestSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/leave/adjust",
  summary: "HR manual balance adjustment on behalf of employee (audited)",
  request: {
    body: {
      content: { "application/json": { schema: AdjustBalanceRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Compensating ledger entry created",
      content: { "application/json": { schema: LeaveLedgerEntrySchema } },
    },
  },
});

// Calendar (M2)
registry.registerPath({
  method: "get",
  path: "/v1/calendar/holidays",
  summary: "Get holidays for location and year",
  responses: {
    200: {
      description: "List of holidays",
      content: { "application/json": { schema: z.array(HolidaySchema) } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/calendar/team-absences",
  summary: "Get team absence schedule respecting GDPR privacy rules",
  responses: {
    200: {
      description: "Team absence schedule",
      content: { "application/json": { schema: z.array(TeamAbsenceSchema) } },
    },
  },
});

// Notifications (M2)
registry.registerPath({
  method: "get",
  path: "/v1/notifications",
  summary: "Get in-app notifications for authenticated user",
  responses: {
    200: {
      description: "Notification list and unread count",
      content: {
        "application/json": { schema: NotificationListResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/notifications/{id}/read",
  summary: "Mark notification as read",
  responses: {
    200: {
      description: "Notification updated",
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
    },
  },
});

// Documents (M4)
registry.registerPath({
  method: "get",
  path: "/v1/documents",
  summary: "List accessible documents",
  responses: {
    200: {
      description: "List of documents",
      content: { "application/json": { schema: z.array(DocumentItemSchema) } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/documents",
  summary: "Upload a new document or version",
  request: {
    body: {
      content: { "application/json": { schema: CreateDocumentRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Document uploaded",
      content: { "application/json": { schema: DocumentItemSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/documents/{id}",
  summary: "Soft delete a document",
  responses: {
    200: {
      description: "Document deleted",
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/documents/payslips/bulk",
  summary: "Bulk upload payslips with auto-matching",
  request: {
    body: {
      content: {
        "application/json": { schema: BulkPayslipUploadRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Bulk payslip processing report",
      content: { "application/json": { schema: BulkPayslipReportSchema } },
    },
  },
});

// Checklists & Lifecycle (M4)
registry.registerPath({
  method: "get",
  path: "/v1/checklists/templates",
  summary: "List checklist templates",
  responses: {
    200: {
      description: "Checklist templates",
      content: {
        "application/json": { schema: z.array(ChecklistTemplateSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/checklists/templates",
  summary: "Create a checklist template",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateChecklistTemplateSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Checklist template created",
      content: { "application/json": { schema: ChecklistTemplateSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/checklists/instances",
  summary: "List checklist instances",
  responses: {
    200: {
      description: "Checklist instances",
      content: {
        "application/json": { schema: z.array(ChecklistInstanceSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/checklists/instances",
  summary: "Instantiate a checklist for employee",
  request: {
    body: {
      content: { "application/json": { schema: InstantiateChecklistSchema } },
    },
  },
  responses: {
    201: {
      description: "Checklist instance created",
      content: { "application/json": { schema: ChecklistInstanceSchema } },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/v1/checklists/tasks/{id}",
  summary: "Toggle checklist task completion status",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ isCompleted: z.boolean() }) },
      },
    },
  },
  responses: {
    200: {
      description: "Task updated",
      content: { "application/json": { schema: z.record(z.unknown()) } },
    },
  },
});

// Employee Bulk Import (M4)
registry.registerPath({
  method: "post",
  path: "/v1/employees/import",
  summary: "Atomic CSV employee import with validation",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            csvContent: z.string(),
            dryRun: z.boolean().default(false),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Import report",
      content: {
        "application/json": { schema: EmployeeImportValidationResponseSchema },
      },
    },
  },
});

// GDPR DSR Export (M4)
registry.registerPath({
  method: "get",
  path: "/v1/employees/{id}/dsr-export",
  summary: "Export all personal data for employee under GDPR Art. 15/20",
  responses: {
    200: {
      description: "Full machine-readable DSR export",
      content: {
        "application/json": { schema: DataSubjectExportResponseSchema },
      },
    },
  },
});

// Reports & Insights (M5)
registry.registerPath({
  method: "get",
  path: "/v1/reports/summary",
  summary: "Get organization HR metrics (headcount, turnover, absences)",
  responses: {
    200: {
      description: "HR summary metrics",
      content: {
        "application/json": { schema: ReportsSummaryResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/reports/gestoria/export",
  summary: "Download monthly Gestoría payroll CSV export (RPT-002)",
  responses: {
    200: {
      description: "RFC 4180 CSV export for payroll gestoría",
      content: {
        "text/csv": { schema: z.string() },
      },
    },
  },
});

// Personal Access Tokens (M5)
registry.registerPath({
  method: "get",
  path: "/v1/tokens",
  summary: "List personal access tokens for authenticated user",
  responses: {
    200: {
      description: "List of PATs",
      content: {
        "application/json": { schema: z.array(PersonalAccessTokenSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/tokens",
  summary: "Create a personal access token",
  request: {
    body: {
      content: {
        "application/json": { schema: CreatePersonalAccessTokenSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Token created (revealed once)",
      content: {
        "application/json": { schema: TokenCreatedResponseSchema },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/tokens/{id}",
  summary: "Revoke a personal access token",
  responses: {
    200: {
      description: "Token revoked",
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
    },
  },
});

// Org Chart (ORG-004)
registry.registerPath({
  method: "get",
  path: "/v1/people/org-chart",
  summary: "Get organization hierarchy tree for org chart",
  responses: {
    200: {
      description: "Org chart tree hierarchy",
      content: { "application/json": { schema: OrgChartResponseSchema } },
    },
  },
});

// Custom Fields (ORG-005)
registry.registerPath({
  method: "get",
  path: "/v1/custom-fields",
  summary: "List custom field definitions",
  responses: {
    200: {
      description: "List of custom field definitions",
      content: {
        "application/json": { schema: z.array(CustomFieldDefinitionSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/custom-fields",
  summary: "Create custom field definition",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateCustomFieldDefinitionSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Custom field definition created",
      content: { "application/json": { schema: CustomFieldDefinitionSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/custom-fields/{id}",
  summary: "Delete custom field definition",
  responses: {
    200: {
      description: "Custom field definition deleted",
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/people/{id}/custom-fields",
  summary: "Get custom field values for an employee",
  responses: {
    200: {
      description: "Custom field values for employee",
      content: {
        "application/json": { schema: z.array(CustomFieldValueSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/people/{id}/custom-fields",
  summary: "Set custom field value for an employee",
  request: {
    body: {
      content: { "application/json": { schema: SetCustomFieldValueSchema } },
    },
  },
  responses: {
    200: {
      description: "Custom field value updated",
      content: { "application/json": { schema: CustomFieldValueSchema } },
    },
  },
});

// Emergency Contacts (EMP-002)
registry.registerPath({
  method: "get",
  path: "/v1/people/{id}/emergency-contacts",
  summary: "List emergency contacts for employee",
  responses: {
    200: {
      description: "Emergency contacts list",
      content: {
        "application/json": { schema: z.array(EmergencyContactSchema) },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/people/{id}/emergency-contacts",
  summary: "Add emergency contact for employee",
  request: {
    body: {
      content: {
        "application/json": { schema: CreateEmergencyContactSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Emergency contact created",
      content: { "application/json": { schema: EmergencyContactSchema } },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/people/{id}/emergency-contacts/{contactId}",
  summary: "Delete emergency contact",
  responses: {
    200: {
      description: "Emergency contact deleted",
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
    },
  },
});

// Employee Self-Service (EMP-005)
registry.registerPath({
  method: "patch",
  path: "/v1/people/{id}/self-service",
  summary: "Self-service update of own employee contact details",
  request: {
    body: {
      content: { "application/json": { schema: SelfServiceUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: "Employee profile updated via self-service",
      content: { "application/json": { schema: EmployeeProfileSchema } },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);
const openApiDoc = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "LibreHR REST API",
    version: "0.1.0",
    description: "LibreHR REST API contracts generated from Zod schemas",
  },
  servers: [{ url: "http://localhost:3001" }],
});

const generatedDir = path.resolve(__dirname, "../generated");
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

// 1. Output openapi.json
fs.writeFileSync(
  path.join(generatedDir, "openapi.json"),
  JSON.stringify(openApiDoc, null, 2),
  "utf-8",
);

// 2. Output typed client
const clientTs = `/**
 * LibreHR API Typed Client
 * Auto-generated by scripts/generate-openapi.ts. Do not edit manually.
 */

import type { SignInRequest, SessionResponse, MeResponse } from '../src/auth.js';
import type {
  OrganizationResponse,
  Department,
  CreateDepartmentRequest,
  Location,
  CreateLocationRequest,
  SetupWizardRequest,
} from '../src/org.js';
import type {
  ListEmployeesQuery,
  ListEmployeesResponse,
  EmployeeProfile,
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
  TerminateEmployeeRequest,
  RevealFieldResponse,
  SelfServiceUpdate,
} from '../src/employees.js';
import type {
  CreateInvitationRequest,
  InvitationResponse,
  InvitationDetails,
  AcceptInvitationRequest,
} from '../src/invitations.js';
import type {
  LeaveType,
  CreateLeaveTypeRequest,
  LeaveBalanceSummary,
  LeaveLedgerEntry,
  LeaveRequest,
  CreateLeaveRequest,
  DecideLeaveRequest,
  AdjustBalanceRequest,
  Holiday,
  TeamAbsence,
} from '../src/leave.js';
import type {
  NotificationListResponse,
} from '../src/notifications.js';
import type {
  TimeEvent,
  ClockRequest,
  ClockStatusResponse,
  PeriodTimesheetResponse,
  CreateTimeCorrection,
  DecideTimeCorrection,
  TimeCorrectionItem,
  OfficialExportResponse,
} from '../src/time.js';
import type {
  DocumentItem,
  CreateDocumentRequest,
  BulkPayslipReport,
  BulkPayslipUploadRequest,
} from '../src/documents.js';
import type {
  ChecklistTemplate,
  CreateChecklistTemplate,
  ChecklistInstance,
  InstantiateChecklist,
  EmployeeImportValidationResponse,
  DataSubjectExportResponse,
} from '../src/lifecycle.js';
import type {
  ReportsSummaryResponse,
} from '../src/reports.js';
import type {
  PersonalAccessTokenItem,
  CreatePersonalAccessToken,
  TokenCreatedResponse,
} from '../src/tokens.js';
import type {
  CustomFieldDefinition,
  CreateCustomFieldDefinition,
  CustomFieldValue,
  SetCustomFieldValue,
} from '../src/custom-fields.js';
import type {
  EmergencyContact,
  CreateEmergencyContact,
} from '../src/emergency-contacts.js';
import type {
  OrgChartResponse,
} from '../src/org-chart.js';
import type { ProblemDetails } from '../src/errors.js';

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch | undefined;
  getHeaders?: (() => Record<string, string> | Promise<Record<string, string>>) | undefined;
}

export class LibreHrApiClient {
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private getHeaders?: (() => Record<string, string> | Promise<Record<string, string>>) | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.getHeaders = options.getHeaders;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const extraHeaders = this.getHeaders ? await this.getHeaders() : {};
    const res = await this.fetchFn(\`\${this.baseUrl}\${path}\`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      let problem: ProblemDetails;
      try {
        problem = (await res.json()) as ProblemDetails;
      } catch {
        problem = {
          type: 'about:blank',
          title: res.statusText,
          status: res.status,
        };
      }
      throw problem;
    }

    return res.json() as Promise<T>;
  }

  async health(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/healthz');
  }

  async ready(): Promise<{ status: string }> {
    return this.request<{ status: string }>('/readyz');
  }

  async signIn(data: SignInRequest): Promise<SessionResponse> {
    return this.request<SessionResponse>('/v1/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('/v1/me');
  }

  async getOrganization(): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>('/v1/org');
  }

  async listEmployees(query?: ListEmployeesQuery): Promise<ListEmployeesResponse> {
    const searchParams = new URLSearchParams();
    if (query?.search) searchParams.set('search', query.search);
    if (query?.departmentId) searchParams.set('departmentId', query.departmentId);
    if (query?.locationId) searchParams.set('locationId', query.locationId);
    if (query?.status) searchParams.set('status', query.status);
    if (query?.page) searchParams.set('page', String(query.page));
    if (query?.pageSize) searchParams.set('pageSize', String(query.pageSize));

    const qs = searchParams.toString();
    return this.request<ListEmployeesResponse>(\`/v1/employees\${qs ? '?' + qs : ''}\`);
  }

  async createEmployee(data: CreateEmployeeRequest): Promise<EmployeeProfile> {
    return this.request<EmployeeProfile>('/v1/employees', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getEmployee(id: string): Promise<EmployeeProfile> {
    return this.request<EmployeeProfile>(\`/v1/employees/\${id}\`);
  }

  async updateEmployee(id: string, data: UpdateEmployeeRequest): Promise<EmployeeProfile> {
    return this.request<EmployeeProfile>(\`/v1/employees/\${id}\`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async terminateEmployee(id: string, data: TerminateEmployeeRequest): Promise<EmployeeProfile> {
    return this.request<EmployeeProfile>(\`/v1/employees/\${id}/terminate\`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revealEmployeeField(id: string, field: 'nationalId' | 'iban'): Promise<RevealFieldResponse> {
    return this.request<RevealFieldResponse>(\`/v1/employees/\${id}/reveal\`, {
      method: 'POST',
      body: JSON.stringify({ field }),
    });
  }

  async listDepartments(): Promise<Department[]> {
    return this.request<Department[]>('/v1/org/departments');
  }

  async createDepartment(data: CreateDepartmentRequest): Promise<Department> {
    return this.request<Department>('/v1/org/departments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listLocations(): Promise<Location[]> {
    return this.request<Location[]>('/v1/org/locations');
  }

  async createLocation(data: CreateLocationRequest): Promise<Location> {
    return this.request<Location>('/v1/org/locations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async runSetupWizard(data: SetupWizardRequest): Promise<{ success: boolean; organizationId: string }> {
    return this.request<{ success: boolean; organizationId: string }>('/v1/org/setup-wizard', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createInvitation(data: CreateInvitationRequest): Promise<InvitationResponse> {
    return this.request<InvitationResponse>('/v1/invitations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getInvitation(token: string): Promise<InvitationDetails> {
    return this.request<InvitationDetails>(\`/v1/invitations/\${token}\`);
  }

  async acceptInvitation(data: AcceptInvitationRequest): Promise<SessionResponse> {
    return this.request<SessionResponse>('/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Time off & Leave (M2)
  async listLeaveTypes(): Promise<LeaveType[]> {
    return this.request<LeaveType[]>('/v1/leave/types');
  }

  async createLeaveType(data: CreateLeaveTypeRequest): Promise<LeaveType> {
    return this.request<LeaveType>('/v1/leave/types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getLeaveBalance(employeeId?: string): Promise<LeaveBalanceSummary> {
    const qs = employeeId ? \`?employeeId=\${employeeId}\` : '';
    return this.request<LeaveBalanceSummary>(\`/v1/leave/balance\${qs}\`);
  }

  async listLeaveRequests(params?: { employeeId?: string; status?: string; year?: number }): Promise<LeaveRequest[]> {
    const searchParams = new URLSearchParams();
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.year) searchParams.set('year', String(params.year));
    const qs = searchParams.toString();
    return this.request<LeaveRequest[]>(\`/v1/leave/requests\${qs ? '?' + qs : ''}\`);
  }

  async createLeaveRequest(data: CreateLeaveRequest): Promise<LeaveRequest> {
    return this.request<LeaveRequest>('/v1/leave/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async decideLeaveRequest(id: string, data: DecideLeaveRequest): Promise<LeaveRequest> {
    return this.request<LeaveRequest>(\`/v1/leave/requests/\${id}/decide\`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async cancelLeaveRequest(id: string): Promise<LeaveRequest> {
    return this.request<LeaveRequest>(\`/v1/leave/requests/\${id}/cancel\`, {
      method: 'POST',
    });
  }

  async adjustLeaveBalance(data: AdjustBalanceRequest): Promise<LeaveLedgerEntry> {
    return this.request<LeaveLedgerEntry>('/v1/leave/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listHolidays(params: { locationId: string; year: number }): Promise<Holiday[]> {
    return this.request<Holiday[]>(\`/v1/calendar/holidays?locationId=\${params.locationId}&year=\${params.year}\`);
  }

  async listTeamAbsences(params: { startDate: string; endDate: string; departmentId?: string }): Promise<TeamAbsence[]> {
    const searchParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.departmentId) searchParams.set('departmentId', params.departmentId);
    return this.request<TeamAbsence[]>(\`/v1/calendar/team-absences?\${searchParams.toString()}\`);
  }

  async listNotifications(): Promise<NotificationListResponse> {
    return this.request<NotificationListResponse>('/v1/notifications');
  }

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(\`/v1/notifications/\${id}/read\`, {
      method: 'PATCH',
    });
  }

  async markAllNotificationsRead(): Promise<{ success: boolean; count: number }> {
    return this.request<{ success: boolean; count: number }>('/v1/notifications/read-all', {
      method: 'POST',
    });
  }

  // Document Acknowledgement (DOC-006)
  async acknowledgeDocument(id: string): Promise<{ success: boolean; acknowledgedAt: string }> {
    return this.request<{ success: boolean; acknowledgedAt: string }>(\`/v1/documents/\${id}/acknowledge\`, {
      method: 'POST',
    });
  }

  async getDocumentAcknowledgements(id: string): Promise<{ id: string; employeeId: string; employeeName: string; acknowledgedAt: string }[]> {
    return this.request<{ id: string; employeeId: string; employeeName: string; acknowledgedAt: string }[]>(\`/v1/documents/\${id}/acknowledgements\`);
  }

  // Time tracking (M3)
  async getClockStatus(): Promise<ClockStatusResponse> {
    return this.request<ClockStatusResponse>('/v1/time/current-status');
  }

  async clock(data: ClockRequest): Promise<TimeEvent> {
    return this.request<TimeEvent>('/v1/time/clock', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getTimesheet(params: { startDate: string; endDate: string; employeeId?: string }): Promise<PeriodTimesheetResponse> {
    const searchParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.employeeId) searchParams.set('employeeId', params.employeeId);
    return this.request<PeriodTimesheetResponse>(\`/v1/time/timesheet?\${searchParams.toString()}\`);
  }

  async getOfficialExport(params: { startDate: string; endDate: string; employeeId?: string }): Promise<OfficialExportResponse> {
    const searchParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.employeeId) searchParams.set('employeeId', params.employeeId);
    return this.request<OfficialExportResponse>(\`/v1/time/export?\${searchParams.toString()}\`);
  }

  async listTimeCorrections(params?: { employeeId?: string; status?: string }): Promise<TimeCorrectionItem[]> {
    const searchParams = new URLSearchParams();
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);
    const qs = searchParams.toString();
    return this.request<TimeCorrectionItem[]>(\`/v1/time/corrections\${qs ? '?' + qs : ''}\`);
  }

  async createTimeCorrection(data: CreateTimeCorrection): Promise<TimeCorrectionItem> {
    return this.request<TimeCorrectionItem>('/v1/time/corrections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async decideTimeCorrection(id: string, data: DecideTimeCorrection): Promise<TimeCorrectionItem> {
    return this.request<TimeCorrectionItem>(\`/v1/time/corrections/\${id}/decide\`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Documents (M4)
  async listDocuments(params?: { employeeId?: string; category?: string; isCompanyWide?: boolean }): Promise<DocumentItem[]> {
    const searchParams = new URLSearchParams();
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.category) searchParams.set('category', params.category);
    if (params?.isCompanyWide !== undefined) searchParams.set('isCompanyWide', String(params.isCompanyWide));
    const qs = searchParams.toString();
    return this.request<DocumentItem[]>(\`/v1/documents\${qs ? '?' + qs : ''}\`);
  }

  async uploadDocument(data: CreateDocumentRequest): Promise<DocumentItem> {
    return this.request<DocumentItem>('/v1/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteDocument(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(\`/v1/documents/\${id}\`, {
      method: 'DELETE',
    });
  }

  async uploadBulkPayslips(data: BulkPayslipUploadRequest): Promise<BulkPayslipReport> {
    return this.request<BulkPayslipReport>('/v1/documents/payslips/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Checklists & Lifecycle (M4)
  async listChecklistTemplates(type?: string): Promise<ChecklistTemplate[]> {
    const searchParams = new URLSearchParams();
    if (type) searchParams.set('type', type);
    const qs = searchParams.toString();
    return this.request<ChecklistTemplate[]>(\`/v1/checklists/templates\${qs ? '?' + qs : ''}\`);
  }

  async createChecklistTemplate(data: CreateChecklistTemplate): Promise<ChecklistTemplate> {
    return this.request<ChecklistTemplate>('/v1/checklists/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listChecklistInstances(params?: { employeeId?: string; status?: string }): Promise<ChecklistInstance[]> {
    const searchParams = new URLSearchParams();
    if (params?.employeeId) searchParams.set('employeeId', params.employeeId);
    if (params?.status) searchParams.set('status', params.status);
    const qs = searchParams.toString();
    return this.request<ChecklistInstance[]>(\`/v1/checklists/instances\${qs ? '?' + qs : ''}\`);
  }

  async instantiateChecklist(data: InstantiateChecklist): Promise<ChecklistInstance> {
    return this.request<ChecklistInstance>('/v1/checklists/instances', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async toggleChecklistTask(taskId: string, isCompleted: boolean): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(\`/v1/checklists/tasks/\${taskId}\`, {
      method: 'PATCH',
      body: JSON.stringify({ isCompleted }),
    });
  }

  // Employee Bulk Import (M4)
  async importEmployeesCsv(csvContent: string, dryRun: boolean = false): Promise<EmployeeImportValidationResponse> {
    return this.request<EmployeeImportValidationResponse>('/v1/employees/import', {
      method: 'POST',
      body: JSON.stringify({ csvContent, dryRun }),
    });
  }

  // GDPR DSR Export (M4)
  async getDataSubjectExport(employeeId: string): Promise<DataSubjectExportResponse> {
    return this.request<DataSubjectExportResponse>(\`/v1/employees/\${employeeId}/dsr-export\`);
  }

  // Reports & Insights (M5)
  async getReportsSummary(params?: { periodStart?: string; periodEnd?: string }): Promise<ReportsSummaryResponse> {
    const searchParams = new URLSearchParams();
    if (params?.periodStart) searchParams.set('periodStart', params.periodStart);
    if (params?.periodEnd) searchParams.set('periodEnd', params.periodEnd);
    const qs = searchParams.toString();
    return this.request<ReportsSummaryResponse>(\`/v1/reports/summary\${qs ? '?' + qs : ''}\`);
  }

  async getGestoriaExportCsv(periodYearMonth: string): Promise<string> {
    return this.request<string>(\`/v1/reports/gestoria/export?periodYearMonth=\${periodYearMonth}\`);
  }

  // Personal Access Tokens (M5)
  async listTokens(): Promise<PersonalAccessTokenItem[]> {
    return this.request<PersonalAccessTokenItem[]>('/v1/tokens');
  }

  async createToken(data: CreatePersonalAccessToken): Promise<TokenCreatedResponse> {
    return this.request<TokenCreatedResponse>('/v1/tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async revokeToken(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(\`/v1/tokens/\${id}\`, {
      method: 'DELETE',
    });
  }

  // Org Chart (ORG-004)
  async getOrgChart(): Promise<OrgChartResponse> {
    return this.request<OrgChartResponse>('/v1/people/org-chart');
  }

  // Custom Fields (ORG-005)
  async listCustomFields(): Promise<CustomFieldDefinition[]> {
    return this.request<CustomFieldDefinition[]>('/v1/custom-fields');
  }

  async createCustomField(data: CreateCustomFieldDefinition): Promise<CustomFieldDefinition> {
    return this.request<CustomFieldDefinition>('/v1/custom-fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteCustomField(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(\`/v1/custom-fields/\${id}\`, {
      method: 'DELETE',
    });
  }

  async getEmployeeCustomFields(employeeId: string): Promise<CustomFieldValue[]> {
    return this.request<CustomFieldValue[]>(\`/v1/people/\${employeeId}/custom-fields\`);
  }

  async setEmployeeCustomField(employeeId: string, data: SetCustomFieldValue): Promise<CustomFieldValue> {
    return this.request<CustomFieldValue>(\`/v1/people/\${employeeId}/custom-fields\`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Emergency Contacts (EMP-002)
  async listEmergencyContacts(employeeId: string): Promise<EmergencyContact[]> {
    return this.request<EmergencyContact[]>(\`/v1/people/\${employeeId}/emergency-contacts\`);
  }

  async createEmergencyContact(employeeId: string, data: CreateEmergencyContact): Promise<EmergencyContact> {
    return this.request<EmergencyContact>(\`/v1/people/\${employeeId}/emergency-contacts\`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteEmergencyContact(employeeId: string, contactId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(\`/v1/people/\${employeeId}/emergency-contacts/\${contactId}\`, {
      method: 'DELETE',
    });
  }

  // Employee Self-Service (EMP-005)
  async selfServiceUpdate(employeeId: string, data: SelfServiceUpdate): Promise<EmployeeProfile> {
    return this.request<EmployeeProfile>(\`/v1/people/\${employeeId}/self-service\`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
}

export const OpenHrApiClient = LibreHrApiClient;
`;

fs.writeFileSync(path.join(generatedDir, "client.ts"), clientTs, "utf-8");
process.stdout.write("OpenAPI JSON and typed client generated successfully.\n");
