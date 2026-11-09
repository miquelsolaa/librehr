import { getApiClient } from "@/lib/api-client";

/**
 * Non-secret profile of the signed-in user, cached so the shell can render
 * names and role-based navigation before the first API call.
 *
 * The session itself lives only in the API's httpOnly `librehr_session`
 * cookie (AUTH-001/002): no token is ever readable from script, so an XSS
 * cannot exfiltrate it. The API stays the authority; a stale profile here
 * only affects what the UI shows, never what the API allows.
 */
export interface ClientSession {
  userId: string;
  email: string;
  name?: string;
  organizationId: string;
  role: string;
}

const AUTH_STORAGE_KEY = "librehr_auth_session";

function isClientSession(value: unknown): value is ClientSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["userId"] === "string" &&
    typeof v["email"] === "string" &&
    typeof v["organizationId"] === "string" &&
    typeof v["role"] === "string"
  );
}

export function getStoredSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isClientSession(parsed)) return null;
    // Earlier versions stored the session token here; drop it.
    if ("token" in parsed) {
      const { userId, email, name, organizationId, role } = parsed;
      const cleaned: ClientSession = {
        userId,
        email,
        organizationId,
        role,
        ...(name !== undefined ? { name } : {}),
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(cleaned));
      return cleaned;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setStoredSession(session: ClientSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Revokes the session server-side (which also clears the cookie) and forgets
 * the cached profile. The local profile is cleared even if the API call
 * fails, so the UI never keeps showing a signed-in state.
 */
export async function signOut(): Promise<void> {
  try {
    await getApiClient().signOut();
  } finally {
    clearStoredSession();
  }
}
