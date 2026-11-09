import { LibreHrApiClient } from "@librehr/contracts";

// Inlined at build time. Unset (local dev) targets the API dev server; an
// empty string means "same origin as the web app" (production behind the
// reverse proxy, which routes /v1/* to the API), so requests are relative.
const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

/**
 * Browser API client. Authentication rides on the httpOnly session cookie the
 * API sets at sign-in (`credentials: "include"`); the client never handles a
 * token. Personal access tokens (Authorization: Bearer) are for non-browser
 * API clients only.
 */
function createClient(): LibreHrApiClient {
  return new LibreHrApiClient({
    baseUrl: API_BASE_URL,
    fetchFn: (input, init) =>
      fetch(input, {
        ...init,
        credentials: "include",
      }),
  });
}

export const apiClient = createClient();

export function getApiClient(): LibreHrApiClient {
  return apiClient;
}

export interface TimeExportFileParams {
  format: "csv" | "pdf";
  startDate: string;
  endDate: string;
  scope: "employee" | "organization";
  locale: "ca" | "es" | "en";
  employeeId?: string;
}

export interface TimeExportFile {
  blob: Blob;
  exportId: string;
  contentHash: string;
  filename: string;
}

/**
 * Reads `filename="..."` (or RFC 5987 `filename*=UTF-8''...`) from a
 * Content-Disposition header. Returns null when absent or unreadable, e.g.
 * when the header is not exposed to cross-origin scripts.
 */
export function filenameFromContentDisposition(
  header: string | null,
): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

/**
 * TIM-006: downloads the official working-time record as CSV or PDF. The
 * generated client only speaks JSON, so this fetches the file directly with
 * the same base URL and session cookie, and reads the integrity headers the
 * API exposes (`X-Export-Id`, `X-Content-SHA256`). Errors are thrown as the
 * API's problem+json body, like the generated client does.
 */
export async function downloadTimeExport(
  params: TimeExportFileParams,
): Promise<TimeExportFile> {
  const search = new URLSearchParams({
    format: params.format,
    scope: params.scope,
    startDate: params.startDate,
    endDate: params.endDate,
    locale: params.locale,
  });
  if (params.employeeId) search.set("employeeId", params.employeeId);

  const res = await fetch(`${API_BASE_URL}/v1/time/export?${search}`, {
    credentials: "include",
  });
  if (!res.ok) {
    let problem: unknown;
    try {
      problem = await res.json();
    } catch {
      problem = { title: res.statusText, status: res.status };
    }
    throw problem;
  }

  // Same name the API sends, for when Content-Disposition is not readable.
  const suffix = params.employeeId ? `-${params.employeeId.slice(0, 8)}` : "";
  const fallback = `registro-jornada-${params.startDate}-${params.endDate}${suffix}.${params.format}`;
  return {
    blob: await res.blob(),
    exportId: res.headers.get("X-Export-Id") ?? "",
    contentHash: res.headers.get("X-Content-SHA256") ?? "",
    filename:
      filenameFromContentDisposition(res.headers.get("Content-Disposition")) ??
      fallback,
  };
}
