import { OpenHrApiClient } from "@openhr/contracts";

const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export function getApiClient(token?: string): OpenHrApiClient {
  return new OpenHrApiClient({
    baseUrl: API_BASE_URL,
    getHeaders: () => (token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

export const apiClient = getApiClient();
