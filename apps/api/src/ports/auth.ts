import type { AuthUser } from "@librehr/contracts";

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

export interface AuthPort {
  verifyCredentials(email: string, password: string): Promise<AuthUser | null>;
  createSession(user: AuthUser): Promise<AuthSession>;
  getSession(token: string): Promise<AuthSession | null>;
  revokeSession(token: string): Promise<void>;
}
