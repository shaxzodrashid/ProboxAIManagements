export interface AuthenticatedUser {
  id: string;
  workspaceId: string;
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: string[];
  type?: "access";
  accessExpiresAt?: number;
  sessionId?: string;
  authenticatedAt?: number;
  accessIssuedAt?: number;
}

export interface AccessTokenPayload {
  id: string;
  workspaceId: string;
  type: "access";
  exp?: number;
  iat?: number;
  sid?: string;
  auth_time?: number;
  issued_at?: number;
}
