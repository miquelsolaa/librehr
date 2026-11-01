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

// Register endpoints
registry.registerPath({
  method: "get",
  path: "/healthz",
  summary: "Liveness check",
  responses: {
    200: { description: "API is healthy and alive" },
  },
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
    body: {
      content: { "application/json": { schema: SignInRequestSchema } },
    },
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
      content: {
        "application/json": {
          schema: z.array(DepartmentSchema),
        },
      },
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
      content: {
        "application/json": {
          schema: z.array(LocationSchema),
        },
      },
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

const generator = new OpenApiGeneratorV31(registry.definitions);
const openApiDoc = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "OpenHR REST API",
    version: "0.1.0",
    description: "OpenHR REST API contracts generated from Zod schemas",
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
 * OpenHR API Typed Client
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
} from '../src/employees.js';
import type {
  CreateInvitationRequest,
  InvitationResponse,
  InvitationDetails,
  AcceptInvitationRequest,
} from '../src/invitations.js';
import type { ProblemDetails } from '../src/errors.js';

export interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch | undefined;
  getHeaders?: (() => Record<string, string> | Promise<Record<string, string>>) | undefined;
}

export class OpenHrApiClient {
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
}
`;

fs.writeFileSync(path.join(generatedDir, "client.ts"), clientTs, "utf-8");
process.stdout.write("OpenAPI JSON and typed client generated successfully.\n");
