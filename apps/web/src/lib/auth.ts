export interface ClientSession {
  userId: string;
  email: string;
  name?: string;
  organizationId: string;
  role: string;
  token: string;
}

const AUTH_STORAGE_KEY = "openhr_auth_session";

export function getStoredSession(): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientSession;
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
