import { LibreHrApiClient } from "@librehr/contracts";

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
