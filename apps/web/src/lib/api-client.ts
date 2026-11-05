import { LibreHrApiClient } from "@librehr/contracts";
import { getStoredSession } from "@/lib/auth";

const API_BASE_URL =
  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export function getApiClient(token?: string): LibreHrApiClient {
  return new LibreHrApiClient({
    baseUrl: API_BASE_URL,
    fetchFn: (input, init) => fetch(input, init),
    getHeaders: () => (token ? { Authorization: `Bearer ${token}` } : {}),
  });
}

export const apiClient = new LibreHrApiClient({
  baseUrl: API_BASE_URL,
  fetchFn: (input, init) => fetch(input, init),
  getHeaders: () => {
    const token = getStoredSession()?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  },
});
