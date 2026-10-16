export interface AuthenticatedUser {
  id: string;
  workspaceId: string;
  roles: Array<{ id: string; key: string; name: string }>;
  permissions: string[];
  type?: "access";
  accessExpiresAt?: number;
}

export interface AccessTokenPayload {
  id: string;
  workspaceId: string;
  type: "access";
  exp?: number;
}
